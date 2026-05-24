const { app, BrowserWindow, ipcMain, dialog, screen } = require('electron');
const amqp = require('amqplib');
const path = require('path');
const fs   = require('fs').promises;

// Load .env from the project root (one level above gui/)
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { MockNFCStrategy } = require('./auth/mock-nfc-strategy');

// console writes throw EIO when there is no TTY (launched from Finder, etc.)
const log = {
    info:  (...a) => { try { console.log(...a);   } catch {} },
    warn:  (...a) => { try { console.warn(...a);  } catch {} },
    error: (...a) => { try { console.error(...a); } catch {} },
};

// electron-reload is a devDependency — only require in development.
if (process.env.NODE_ENV === 'development') {
    try {
        require('electron-reload')(__dirname, {
            electron: path.join(__dirname, 'node_modules', '.bin', 'electron'),
        });
    } catch (e) {
        log.warn('[Electron] electron-reload not available:', e.message);
    }
}

const AGENT_ID           = process.env.AGENT_ID || 'bench-01';
const RABBIT_URL         = process.env.RABBIT_URL || 'amqp://localhost';
const OPERATORS_API_BASE = process.env.OPERATORS_API_BASE || 'https://vlahovski.info/api/v1';
const RECONNECT_MS       = 5000;

let mainWindow;
let nfcStrategy = null;

function sendBroker(status, extra = {}) {
    try { mainWindow?.webContents?.send('gui_broker', { status, ...extra }); } catch {}
}

function sendAuth(type, payload = {}) {
    try { mainWindow?.webContents?.send('gui_auth', { type, ...payload }); } catch {}
}

function setupNFC() {
    const useMock = process.env.MOCK_NFC === '1' || process.env.NODE_ENV === 'development';
    let Cls;
    if (useMock) {
        Cls = MockNFCStrategy;
    } else {
        // Lazy-load the native PC-SC addon only in production.
        // In dev mode this require never runs, avoiding the NODE_MODULE_VERSION mismatch.
        // For production: run `npx electron-rebuild` after npm install.
        try {
            Cls = require('./auth/nfc-strategy').NFCAuthStrategy;
        } catch (e) {
            log.error('[NFC] Failed to load nfc-strategy:', e.message);
            log.error('[NFC] Run: npx electron-rebuild   to recompile native modules for Electron.');
            sendAuth('nfc_error', { message: 'NFC module not compiled for this Electron version. Run: npx electron-rebuild' });
            return;
        }
    }
    nfcStrategy = new Cls({ operatorsApiBase: OPERATORS_API_BASE });

    nfcStrategy.on('reader_attached', ({ name }) => {
        log.info(`[NFC] Reader attached: ${name}`);
        sendAuth('reader_attached', { name });
    });

    nfcStrategy.on('reader_detached', ({ name }) => {
        log.warn(`[NFC] Reader detached: ${name}`);
        sendAuth('reader_detached', { name });
    });

    nfcStrategy.on('authenticated', ({ operator }) => {
        log.info(`[NFC] Authenticated: ${operator.name} (${operator.badge_uid})`);
        sendAuth('authenticated', { operator });
    });

    nfcStrategy.on('deauthenticated', () => {
        log.info('[NFC] Card removed — deauthenticated');
        sendAuth('deauthenticated');
    });

    nfcStrategy.on('error', ({ message }) => {
        log.warn(`[NFC] ${message}`);
        sendAuth('nfc_error', { message });
    });

    nfcStrategy.start();
}

async function createWindow() {
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;
    mainWindow = new BrowserWindow({
        width,
        height,
        fullscreen: false,
        kiosk: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });

    // mainWindow.webContents.openDevTools();

    try {
        await mainWindow.loadFile('index.html');
    } catch (err) {
        log.error('[Electron] Failed to load GUI:', err);
    }
}

async function setupRabbit() {
    sendBroker('connecting');
    try {
        const conn    = await amqp.connect(RABBIT_URL);
        const channel = await conn.createChannel();

        // Declare all exchanges the GUI depends on — idempotent, matches
        // the type used by mock_publisher.py and executor.py.
        // This makes the GUI self-sufficient: it can connect before the
        // publisher/executor start without crashing on a missing exchange.
        await channel.assertExchange('instruments',  'direct', { durable: false });
        await channel.assertExchange('agent_status', 'direct', { durable: false });
        await channel.assertExchange('results',      'direct', { durable: false });

        const qStatus      = await channel.assertQueue(`gui_status.${AGENT_ID}`,      { durable: false });
        const qResults     = await channel.assertQueue(`gui_results.${AGENT_ID}`,     { durable: false });
        const qInstruments = await channel.assertQueue(`gui_instruments.${AGENT_ID}`, { durable: false });

        await channel.bindQueue(qStatus.queue,      'agent_status', `${AGENT_ID}.status`);
        await channel.bindQueue(qResults.queue,     'results',      `${AGENT_ID}.result`);
        await channel.bindQueue(qInstruments.queue, 'instruments',  `${AGENT_ID}.instruments`);

        channel.consume(qStatus.queue, (msg) => {
            if (msg !== null) {
                mainWindow.webContents.send('gui_status', JSON.parse(msg.content.toString()));
                channel.ack(msg);
            }
        });

        channel.consume(qResults.queue, (msg) => {
            if (msg !== null) {
                mainWindow.webContents.send('gui_results', JSON.parse(msg.content.toString()));
                channel.ack(msg);
            }
        });

        channel.consume(qInstruments.queue, (msg) => {
            if (msg !== null) {
                mainWindow.webContents.send('gui_instruments', JSON.parse(msg.content.toString()));
                channel.ack(msg);
            }
        });

        sendBroker('ok', { url: RABBIT_URL });
        log.info(`[RabbitMQ] Connected to ${RABBIT_URL}. Listening for agent ${AGENT_ID}...`);

        conn.on('error', (err) => {
            log.error('[RabbitMQ] Connection error:', err.message);
        });

        conn.on('close', () => {
            log.warn('[RabbitMQ] Connection closed — reconnecting in', RECONNECT_MS, 'ms');
            sendBroker('reconnecting');
            setTimeout(setupRabbit, RECONNECT_MS);
        });

    } catch (error) {
        log.error('[RabbitMQ] Setup error:', error.message);
        sendBroker('error', { message: error.message });
        setTimeout(setupRabbit, RECONNECT_MS);
    }
}

// ── File dialog IPC ──────────────────────────────────────────────

ipcMain.handle('scada:open-project', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
        title:   'Open SCADA Project',
        filters: [
            { name: 'SCADA Project', extensions: ['scada'] },
            { name: 'All Files',     extensions: ['*'] },
        ],
        properties: ['openFile'],
    });
    if (canceled || !filePaths.length) return null;
    const filePath = filePaths[0];
    const text     = await fs.readFile(filePath, 'utf-8');
    return { path: filePath, data: JSON.parse(text) };
});

ipcMain.handle('scada:save-project', async (_e, { data, suggestedName }) => {
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
        title:       'Save SCADA Project',
        defaultPath: suggestedName || 'project.scada',
        filters:     [{ name: 'SCADA Project', extensions: ['scada'] }],
    });
    if (canceled || !filePath) return null;
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
    return filePath;
});

ipcMain.handle('scada:open-step', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
        title:   'Load STEP / IGES File',
        filters: [
            { name: 'CAD Files',  extensions: ['step', 'stp', 'iges', 'igs'] },
            { name: 'All Files',  extensions: ['*'] },
        ],
        properties: ['openFile'],
    });
    if (canceled || !filePaths.length) return null;
    const filePath = filePaths[0];
    const buf      = await fs.readFile(filePath);
    // Extract a properly-owned ArrayBuffer slice (Buffer.buffer may be a pool)
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    return { name: path.basename(filePath), path: filePath, buffer: ab };
});

app.whenReady().then(async () => {
    await createWindow();
    setupRabbit().catch((err) => log.error('[RabbitMQ] Fatal:', err.message));
    setupNFC();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
