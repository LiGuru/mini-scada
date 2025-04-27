// GUI Main Process (Placeholder)
const { app, BrowserWindow, ipcMain, screen } = require('electron');
const amqp = require('amqplib');
const path = require('path');

let mainWindow;

async function setupRabbit() {
    try {
        const conn = await amqp.connect('amqp://localhost');
        const channel = await conn.createChannel();

        await channel.assertExchange('gui_results', 'fanout', { durable: false });
        await channel.assertExchange('gui_status', 'fanout', { durable: false });
        await channel.assertExchange('device_status', 'fanout', { durable: false });
        await channel.assertExchange('bench_status', 'fanout', { durable: false });

        const qStatus = await channel.assertQueue('', { exclusive: true });
        const qResults = await channel.assertQueue('', { exclusive: true });
        const qDevices = await channel.assertQueue('', { exclusive: true });
        const qBench = await channel.assertQueue('', { exclusive: true });

        await channel.bindQueue(qStatus.queue, 'gui_status', 'gui_status.bench-01');
        await channel.bindQueue(qResults.queue, 'gui_results', 'gui_results.bench-01');
        await channel.bindQueue(qDevices.queue, 'device_status', '');
        await channel.bindQueue(qBench.queue, 'bench_status', '');

        channel.consume(qStatus.queue, msg => {
            const content = JSON.parse(msg.content.toString());
            mainWindow.webContents.send('gui_status', content);
        }, { noAck: true });

        channel.consume(qResults.queue, msg => {
            const content = JSON.parse(msg.content.toString());
            mainWindow.webContents.send('measurement', content);
        }, { noAck: true });

        channel.consume(qDevices.queue, msg => {
            const content = JSON.parse(msg.content.toString());
            mainWindow.webContents.send('device_status', content);
        }, { noAck: true });

        channel.consume(qBench.queue, msg => {
            const content = JSON.parse(msg.content.toString());
            mainWindow.webContents.send('gui_results', content);
        }, { noAck: true });

        console.log('[RabbitMQ] Listening for messages...');
    } catch (error) {
        console.error('[RabbitMQ] Error setting up:', error);
    }
}

async function createWindow() {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.workAreaSize;

    mainWindow = new BrowserWindow({
        width: width,
        height: height,
        fullscreen: true,
        kiosk: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    try {
        await mainWindow.loadFile('index.html');
        console.log("[Electron] GUI loaded successfully.");
    } catch (err) {
        console.error("[Electron] Failed to load GUI:", err);
    }

    mainWindow.webContents.on('before-input-event', (event, input) => {
        if (input.key === 'Escape') {
            console.log('[DEV MODE] ESC pressed - exiting kiosk and fullscreen');
            mainWindow.setKiosk(false);
            mainWindow.setFullScreen(false);
        }
    });

    ipcMain.on('start_listening', async () => {
        console.log("[Electron] Starting RabbitMQ listener...");
        await setupRabbit();
    });

    // Симулирана NFC аутентикация (след 5 секунди)
    setTimeout(() => {
        mainWindow.webContents.send('nfc_authenticated', {
            id: '12345',
            name: 'Test Operator'
        });
    }, 5000);
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
