const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    onBrokerStatus: (callback) => ipcRenderer.on('gui_broker',      (_e, data) => callback(data)),
    onStatus:       (callback) => ipcRenderer.on('gui_status',      (_e, data) => callback(data)),
    onMeasurement:  (callback) => ipcRenderer.on('gui_results',     (_e, data) => callback(data)),
    onInstruments:  (callback) => ipcRenderer.on('gui_instruments', (_e, data) => callback(data)),
});
