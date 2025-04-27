const { app, BrowserWindow, ipcMain, screen } = require('electron');

const amqp = require('amqplib');
const path = require('path');

let mainWindow;

async function createWindow() {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.workAreaSize;
    mainWindow = new BrowserWindow({
        width: width,
        height: height,
        fullscreen: true,
        kiosk: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    try {
        await mainWindow.loadFile('index.html');
    } catch (err) {
        console.error("[Electron] Failed to load GUI:", err);
    }
}

// Функция за настройване на RabbitMQ
async function setupRabbit() {
    try {
        const conn = await amqp.connect('amqp://localhost');
        const channel = await conn.createChannel();

        // Деклариране на опашките за GUI
        const qStatus = await channel.assertQueue('gui_status.bench-01', { durable: false });
        const qResults = await channel.assertQueue('gui_results.bench-01', { durable: false });

        // Слушане за съобщения на тези опашки
        channel.consume(qStatus.queue, (msg) => {
            if (msg !== null) {
                const content = JSON.parse(msg.content.toString());
                console.log('Received gui_status consume:', content);
                mainWindow.webContents.send( 'gui_status', content);  // Изпращане към renderer
                channel.ack(msg);  // Потвърдете получаването на съобщението
            }
        });

        channel.consume(qResults.queue, (msg) => {
            if (msg !== null) {
                const content = JSON.parse(msg.content.toString());
                console.log('Received gui_results consume:', content);
                mainWindow.webContents.send('gui_results', content);  // Изпращане към renderer
                channel.ack(msg);  // Потвърдете получаването на съобщението
            }
        });

        console.log('[RabbitMQ] Listening for messages on gui_status and gui_results...');
    } catch (error) {
        console.error('[RabbitMQ] Error setting up:', error);
    }
}

// Стартиране на приложението
app.whenReady().then(() => {
    createWindow();
    setupRabbit();  // Инициализация на RabbitMQ
});

// Когато всички прозорци бъдат затворени, приключваме приложението
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
