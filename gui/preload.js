const { contextBridge, ipcRenderer } = require('electron');

// Read preferences synchronously BEFORE the renderer module executes.
// This lets initTheme() apply the saved theme with zero flash, without
// relying on localStorage (which LevelDB may not have flushed after
// a hot-reload kill).
const _initialPrefs = (() => {
    try { return ipcRenderer.sendSync('scada:prefs-get-sync'); } catch { return {}; }
})();

contextBridge.exposeInMainWorld('electronAPI', {
    // ── User preferences ──────────────────────────────────────────
    /** Synchronously available initial prefs (theme, lang, …). */
    initialPrefs: _initialPrefs,
    /** Persist a preference patch; returns when the file is written. */
    setPrefs: (patch) => ipcRenderer.invoke('scada:prefs-set', patch),
    // ── AMQP / agent data ─────────────────────────────────────────
    onBrokerStatus:    (callback) => ipcRenderer.on('gui_broker',      (_e, data) => callback(data)),
    /** Pull the current broker status once (avoids race on fast connections). */
    getBrokerStatus:   ()         => ipcRenderer.invoke('scada:broker-status'),
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

    // ── Altium PCB / Schematic files ──────────────────────────────
    /** Opens a native dialog, reads the file, and returns { name, path, buffer } or null. */
    openAltium:   ()                     => ipcRenderer.invoke('scada:open-altium'),

    // ── Generic file read ─────────────────────────────────────────
    /** Read an arbitrary file by absolute path; returns { name, path, buffer } or { error }. */
    readFile:     (filePath)             => ipcRenderer.invoke('scada:read-file', filePath),

    // ── FreeCAD ───────────────────────────────────────────────────
    /** Detect FreeCAD installation; returns the binary path or null. */
    detectFreeCAD: ()                    => ipcRenderer.invoke('freecad:detect'),
    /** Convert a CAD file using FreeCAD; returns { ok, outputPath, error? }. */
    convertStep:   (inputPath, fmt)      => ipcRenderer.invoke('freecad:convert', { inputPath, fmt }),

    // ── Instrument control (bidirectional Keysight executor) ───────
    /** Called when a runner sends a registration / heartbeat. */
    onInstrReg:   (callback) => ipcRenderer.on('gui_instr_reg',   (_e, data) => callback(data)),
    /** Called when telemetry arrives for any instrument. */
    onInstrData:  (callback) => ipcRenderer.on('gui_instr_data',  (_e, data) => callback(data)),
    /** Called when a command reply arrives for this GUI session. */
    onInstrReply: (callback) => ipcRenderer.on('gui_instr_reply', (_e, data) => callback(data)),
    /**
     * Send an instrument command.
     * payload: { agent_id?, instr_id, action, token?, cmd?, args? }
     * Returns: { ok, correlation_id } or { error }
     */
    sendInstrCmd: (payload)  => ipcRenderer.invoke('instr:cmd', payload),
});
