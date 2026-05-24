const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // ── AMQP / agent data ─────────────────────────────────────────
    onBrokerStatus: (callback) => ipcRenderer.on('gui_broker',      (_e, data) => callback(data)),
    onStatus:       (callback) => ipcRenderer.on('gui_status',      (_e, data) => callback(data)),
    onMeasurement:  (callback) => ipcRenderer.on('gui_results',     (_e, data) => callback(data)),
    onInstruments:  (callback) => ipcRenderer.on('gui_instruments', (_e, data) => callback(data)),
    onAuth:         (callback) => ipcRenderer.on('gui_auth',        (_e, data) => callback(data)),

    // ── Project files ─────────────────────────────────────────────
    /** Opens a native dialog and returns { path, data } or null. */
    openProject:  ()                     => ipcRenderer.invoke('scada:open-project'),
    /** Saves data to a native-dialog path; returns the saved path or null. */
    saveProject:  (data, suggestedName)  => ipcRenderer.invoke('scada:save-project', { data, suggestedName }),

    // ── STEP / IGES files ─────────────────────────────────────────
    /** Opens a native dialog, reads the file, and returns { name, path, buffer } or null. */
    openStep:     ()                     => ipcRenderer.invoke('scada:open-step'),
});
