const { app, BrowserWindow, ipcMain, screen } = require('electron');
const amqp = require('amqplib');
const path = require('path');
const { NFCAuthStrategy }    = require('./auth/nfc-strategy');
const { MockNFCStrategy }    = require('./auth/mock-nfc-strategy');

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
    const Cls     = useMock ? MockNFCStrategy : NFCAuthStrategy;
    nfcStrategy   = new Cls({ operatorsApiBase: OPERATORS_API_BASE });

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

        const qStatus      = await channel.assertQueue(`gui_status.${AGENT_ID}`,      { durable: false });
        const qResults     = await channel.assertQueue(`gui_results.${AGENT_ID}`,     { durable: false });
        const qInstruments = await channel.assertQueue(`gui_instruments.${AGENT_ID}`, { durable: false });

        await channel.bindQueue(qInstruments.queue, 'instruments', `${AGENT_ID}.instruments`);

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

app.whenReady().then(async () => {
    await createWindow();
    setupRabbit();
    setupNFC();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
