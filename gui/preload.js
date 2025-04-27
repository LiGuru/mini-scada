// GUI Preload Script (Placeholder)
const { contextBridge, ipcRenderer } = require('electron');
const { readFileSync } = require('fs');
const path = require('path');

const packageJson = JSON.parse(
    readFileSync(path.join(__dirname, 'package.json'), 'utf-8')
);

contextBridge.exposeInMainWorld('electronAPI', {
    version: packageJson.version,
    startListening: () => ipcRenderer.send('start_listening'),
    onStatus: (callback) => ipcRenderer.on('agent_status', (event, data) => callback(data)),
    onMeasurement: (callback) => ipcRenderer.on('measurement', (event, data) => callback(data)),
    onDeviceStatus: (callback) => ipcRenderer.on('device_status', (event, data) => callback(data)),
    onBenchStatus: (callback) => ipcRenderer.on('bench_status', (event, data) => callback(data)),
    onNFCAuth: (callback) => ipcRenderer.on('nfc_authenticated', (event, data) => callback(data))
});
