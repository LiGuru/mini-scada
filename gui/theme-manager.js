/**
 * theme-manager.js — Theme switching and persistence.
 *
 * Themes are applied via body[data-theme="..."].
 * Preference is stored in localStorage under LS_KEY.
 */

const LS_KEY  = 'scada_theme';
const DEFAULT = 'industrial';

export const THEMES = [
    {
        id:      'industrial',
        label:   'Industrial',
        swatches: ['#0b0e14', '#111520', '#00bcd4', '#00c896'],
    },
    {
        id:      'light',
        label:   'Light',
        swatches: ['#eef2f8', '#ffffff', '#0090b0', '#00906a'],
    },
    {
        id:      'paperwhite',
        label:   'Paperwhite',
        swatches: ['#f5f0e8', '#faf7f2', '#1a5f70', '#3d6b50'],
    },
];

export function getTheme() {
    return localStorage.getItem(LS_KEY) || DEFAULT;
}

export function applyTheme(id) {
    if (!THEMES.find(t => t.id === id)) id = DEFAULT;
    document.body.dataset.theme = id;
    localStorage.setItem(LS_KEY, id);
    // Update <html lang> doesn't apply here but keep hook for future

    // Notify any listeners (e.g. config UI to update selected card)
    document.dispatchEvent(new CustomEvent('scada:themechange', { detail: { theme: id } }));
}

export function initTheme() {
    let saved = localStorage.getItem(LS_KEY) || DEFAULT;
    // Migrate old theme ids → new names
    if (saved === 'dark') saved = 'industrial';
    if (saved === 'hc')   saved = 'industrial';
    applyTheme(saved);
}
