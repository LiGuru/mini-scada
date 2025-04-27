const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    onStatus: (callback) => ipcRenderer.on('gui_status', (event, data) => callback(data)),
    onMeasurement: (callback) => ipcRenderer.on('gui_results', (event, data) => callback(data)),
});
