// GUI Renderer Script (Placeholder)
const api = window.electronAPI;

const logBox = document.getElementById('log');
const measurements = document.getElementById('measurements');
const statusLine = document.getElementById('agentState');
const agentId = document.getElementById('agentId');
const devicesPanel = document.getElementById('devicesPanel');
const nfcUser = document.getElementById('nfcUser');
const startBtn = document.getElementById('startBtn');

document.getElementById('guiVersion').innerText = api.version;

function log(message) {
    const timestamp = new Date().toLocaleTimeString();
    logBox.innerHTML += `[${timestamp}] ${message}<br>`;
    logBox.scrollTop = logBox.scrollHeight;
}

let devices = {};

function updateDevicesPanel() {
    devicesPanel.innerHTML = '';
    Object.keys(devices).forEach(deviceId => {
        const dev = devices[deviceId];
        let color = 'gray';
        let icon = '⚪️';
        if (dev.status === 'ready') { color = 'green'; icon = '🟢'; }
        else if (dev.status === 'busy') { color = 'orange'; icon = '🟠'; }
        else if (dev.status === 'error') { color = 'red'; icon = '🔴'; }

        const html = `<div class="device" style="color:${color}">${icon} <strong>${deviceId}</strong> — ${dev.details}</div>`;
        devicesPanel.innerHTML += html;
    });
}

startBtn.addEventListener('click', () => {
    api.startListening();
    log('Started listening for RabbitMQ updates...');
});

api.onStatus((status) => {
    agentId.innerText = status.agent_id || 'unknown';
    statusLine.innerText = status.status || '--';
    log(`Agent Status: ${JSON.stringify(status)}`);
});

api.onMeasurement((result) => {
    measurements.innerText = `Voltage: ${result.details.voltage} V, Current: ${result.details.current} A, Temp: ${result.details.temperature} °C`;
    log(`Measurement: ${JSON.stringify(result)}`);
});

api.onDeviceStatus((device) => {
    devices[device.device_id] = {
        status: device.status,
        details: device.details
    };
    updateDevicesPanel();
});

api.onBenchStatus((bench) => {
    document.getElementById('benchAttributes').innerText =
        `Bench ID: ${bench.bench_id}, Location: ${bench.location}, Connected: ${bench.connected_devices.join(', ')}`;
});

api.onNFCAuth((userData) => {
    nfcUser.innerText = `${userData.name} (ID: ${userData.id})`;
    log(`User authenticated via NFC: ${userData.name}`);
});
