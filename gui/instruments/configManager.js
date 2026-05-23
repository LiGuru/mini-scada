/**
 * configManager.js
 *
 * Runtime configuration store for dynamic instruments and modules.
 * Reads from localStorage; seeds from modules.config.js defaults on first use.
 * All writes are synchronous and immediately visible to the next read.
 */

import {
    DYNAMIC_INSTRUMENT_CONFIG as DEFAULTS_INSTR,
    MODULE_CONFIG             as DEFAULTS_MOD,
} from '../modules.config.js?v=2';

const LS_INSTR = 'scada_dyn_instruments';
const LS_MOD   = 'scada_modules';

// ── Dynamic Instruments ───────────────────────────────────────────

export function getDynInstruments() {
    let cfg = null;
    try {
        const raw = localStorage.getItem(LS_INSTR);
        if (raw) cfg = JSON.parse(raw);
    } catch {}

    if (!cfg) return structuredClone(DEFAULTS_INSTR);

    // Ensure fixed instruments are always present, even if localStorage was
    // written before they were added to the defaults (migration guard).
    let dirty = false;
    for (const [key, def] of Object.entries(DEFAULTS_INSTR)) {
        if (def.fixed && !(key in cfg)) {
            cfg[key] = structuredClone(def);
            dirty = true;
        }
    }
    if (dirty) localStorage.setItem(LS_INSTR, JSON.stringify(cfg));
    return cfg;
}

export function saveDynInstruments(cfg) {
    localStorage.setItem(LS_INSTR, JSON.stringify(cfg));
}

export function upsertDynInstrument(key, entry) {
    const cfg = getDynInstruments();
    cfg[key] = entry;
    saveDynInstruments(cfg);
}

export function removeDynInstrument(key) {
    const cfg = getDynInstruments();
    delete cfg[key];
    saveDynInstruments(cfg);
}

// ── Modules ───────────────────────────────────────────────────────

export function getModules() {
    try {
        const raw = localStorage.getItem(LS_MOD);
        if (raw) return JSON.parse(raw);
    } catch {}
    return structuredClone(DEFAULTS_MOD);
}

export function saveModules(cfg) {
    localStorage.setItem(LS_MOD, JSON.stringify(cfg));
}

export function upsertModule(key, entry) {
    const cfg = getModules();
    cfg[key] = entry;
    saveModules(cfg);
}

export function removeModule(key) {
    const cfg = getModules();
    delete cfg[key];
    saveModules(cfg);
}

// ── Reset ─────────────────────────────────────────────────────────

export function resetDefaults() {
    localStorage.removeItem(LS_INSTR);
    localStorage.removeItem(LS_MOD);
}
