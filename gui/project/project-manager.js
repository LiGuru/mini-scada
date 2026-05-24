/**
 * project-manager.js — .scada project file serialisation / deserialisation.
 *
 * A .scada file is a JSON document that captures the full bench configuration:
 *   instruments, modules, theme, language, and a list of loaded 3D model paths.
 *
 * Format (v1):
 * {
 *   scada_version: "1",
 *   meta: { name, created, modified },
 *   config: { theme, language, instruments, modules },
 *   models: [{ id, name, path, color, visible }]
 * }
 *
 * This module is UI-agnostic — it only reads/writes state.  Callers are
 * responsible for triggering DOM refreshes after import.
 */

import { getDynInstruments, saveDynInstruments,
         getModules, saveModules }           from '../instruments/configManager.js?v=2';
import { getTheme, applyTheme }              from '../theme-manager.js?v=1';
import { getLang, setLang }                  from '../i18n.js?v=1';

export const SCADA_VERSION = '1';

// ── Export ────────────────────────────────────────────────────────

/**
 * Serialise the current app state into a .scada document object.
 * @param {Array} models  Current model list from models-view (path/color/visible).
 * @param {string} [name] Human-readable project name.
 * @returns {object}
 */
export function exportProject(models = [], name = 'Untitled') {
    const now = new Date().toISOString();
    return {
        scada_version: SCADA_VERSION,
        meta: {
            name,
            created:  now,
            modified: now,
        },
        config: {
            theme:       getTheme(),
            language:    getLang(),
            instruments: getDynInstruments(),
            modules:     getModules(),
        },
        // Strip the Three.js _group reference; keep only serialisable fields.
        models: models.map(({ id, name: n, path, color, visible }) => ({
            id, name: n, path, color, visible,
        })),
    };
}

// ── Import ────────────────────────────────────────────────────────

/**
 * Apply a loaded .scada document to the app state.
 *
 * Returns the model list so the caller can re-load the 3D files.
 * Throws on invalid documents.
 *
 * @param {object} doc  Parsed JSON from a .scada file.
 * @returns {{ models: Array }}
 */
export async function importProject(doc) {
    if (!doc || doc.scada_version !== SCADA_VERSION) {
        throw new Error('Not a valid v1 .scada file');
    }

    const cfg = doc.config || {};

    if (cfg.instruments) saveDynInstruments(cfg.instruments);
    if (cfg.modules)     saveModules(cfg.modules);
    if (cfg.theme)       applyTheme(cfg.theme);
    if (cfg.language)    await setLang(cfg.language);

    return { models: Array.isArray(doc.models) ? doc.models : [] };
}
