/**
 * i18n.js — Lightweight translation module.
 *
 * Usage:
 *   import { t, setLang, getLang, initI18n } from './i18n.js?v=1';
 *
 *   t('broker.ok')                       → "BROKER OK"
 *   t('broker.conn_ok', { url: '...' }) → "Broker connected · amqp://..."
 *
 * HTML:
 *   <span data-i18n="broker.ok">BROKER OK</span>
 *   <input data-i18n-placeholder="modal.keyLbl">
 *
 * Call applyI18n() after language change to update all [data-i18n] elements.
 */

const LS_KEY  = 'scada_lang';
const DEFAULT = 'en';

export const LANGS = [
    { id: 'en', label: 'English', flag: '🇬🇧' },
    { id: 'bg', label: 'Български', flag: '🇧🇬' },
];

// Loaded translation dictionaries
const _dicts = {};
let   _current = DEFAULT;

// ── Core ──────────────────────────────────────────────────────────

async function _load(lang) {
    if (_dicts[lang]) return;
    try {
        const res  = await fetch(`./i18n/${lang}.json`);
        _dicts[lang] = await res.json();
    } catch {
        _dicts[lang] = {};
    }
}

function _resolve(dict, key) {
    return key.split('.').reduce((o, k) => (o && o[k] !== undefined ? o[k] : undefined), dict);
}

/** Translate a dot-notation key with optional {placeholder} interpolation. */
export function t(key, vars = {}) {
    const cur = _resolve(_dicts[_current], key);
    const val = cur !== undefined ? cur : (_resolve(_dicts[DEFAULT], key) ?? key);
    return String(val).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
}

export function getLang() { return _current; }

/** Apply translations to all [data-i18n] elements in the DOM. */
export function applyI18n() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
        el.textContent = t(el.dataset.i18n);
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        el.placeholder = t(el.dataset.i18nPlaceholder);
    });
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
        el.title = t(el.dataset.i18nTitle);
    });
    document.dispatchEvent(new CustomEvent('scada:langchange', { detail: { lang: _current } }));
}

/** Switch language, persist, and re-apply translations. */
export async function setLang(lang) {
    if (!LANGS.find(l => l.id === lang)) lang = DEFAULT;
    await _load(lang);
    _current = lang;
    localStorage.setItem(LS_KEY, lang);
    applyI18n();
}

/** Load saved language on startup (must be awaited before first render). */
export async function initI18n() {
    const saved = localStorage.getItem(LS_KEY) || DEFAULT;
    // Always pre-load English as fallback
    await Promise.all([_load(DEFAULT), _load(saved)]);
    _current = saved;
    applyI18n();
}
