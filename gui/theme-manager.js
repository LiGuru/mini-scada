/**
 * theme-manager.js — Theme switching and persistence.
 *
 * Themes are applied via body[data-theme="..."].
 * Preference is stored in localStorage under LS_KEY.
 */

const LS_KEY  = 'scada_theme';
const DEFAULT = 'dark';

export const THEMES = [
    {
        id:      'dark',
        label:   'Dark',
        swatches: ['#0b0e14', '#111520', '#00bcd4', '#00c896'],
    },
    {
        id:      'light',
        label:   'Light',
        swatches: ['#eef1f6', '#ffffff', '#0096b0', '#00a06e'],
    },
    {
        id:      'hc',
        label:   'High Contrast',
        swatches: ['#000000', '#0d0d0d', '#00eeff', '#00ff99'],
    },
];

export function getTheme() {
    return localStorage.getItem(LS_KEY) || DEFAULT;
}

export function applyTheme(id) {
    if (!THEMES.find(t => t.id === id)) id = DEFAULT;
    document.body.dataset.theme = id;
    localStorage.setItem(LS_KEY, id);

    // Notify any listeners (e.g. config UI to update selected card)
    document.dispatchEvent(new CustomEvent('scada:themechange', { detail: { theme: id } }));
}

export function initTheme() {
    applyTheme(getTheme());
}
