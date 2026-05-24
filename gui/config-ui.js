/**
 * config-ui.js
 *
 * Settings tab — add, edit, delete dynamic instruments and modules.
 * All changes persist to localStorage via configManager.
 * DOM elements for removed entries are cleaned up so they get
 * recreated (with new config) the next time live data arrives.
 */

import {
    getDynInstruments, saveDynInstruments, upsertDynInstrument, removeDynInstrument,
    getModules, saveModules, upsertModule, removeModule, resetDefaults,
} from './instruments/configManager.js?v=2';
import { THEMES, applyTheme, getTheme } from './theme-manager.js?v=1';

const PALETTE = ['#00c896', '#00bcd4', '#f0a500', '#a78bfa', '#f472b6', '#38bdf8', '#fb923c', '#4ade80'];

// ── State ─────────────────────────────────────────────────────────

let _editMode = null;   // 'instr' | 'mod'
let _editKey  = null;   // null → adding new

// ── List rendering ────────────────────────────────────────────────

export function renderConfigLists() {
    _renderInstrList();
    _renderModList();
}

function _renderInstrList() {
    const el = document.getElementById('cfgInstrList');
    if (!el) return;
    const cfg     = getDynInstruments();
    const entries = Object.entries(cfg);

    if (entries.length === 0) {
        el.innerHTML = '<div class="cfg-empty">No dynamic instruments. Click "+ Add" to create one.</div>';
        return;
    }
    el.innerHTML = entries.map(([key, c]) => {
        const n    = (c.fields || []).length;
        const conn = c.connection;
        const connBadge = conn?.type === 'ip'
            ? `<span class="cfg-conn-badge ip">IP ${conn.ip || '—'}</span>`
            : conn?.type === 'usb'
            ? `<span class="cfg-conn-badge usb">USB</span>`
            : '';
        return `
        <div class="cfg-item${c.fixed ? ' cfg-item-fixed' : ''}">
            <i class="${c.icon || 'fas fa-gauge'} cfg-item-icon"></i>
            <div class="cfg-item-info">
                <span class="cfg-item-label">${c.label || key}${c.fixed ? ' <span class="cfg-fixed-tag">FIXED</span>' : ''}${connBadge}</span>
                <span class="cfg-item-key">${key} &middot; ${n} field${n !== 1 ? 's' : ''}${c.primaryKey ? ' &middot; pk: ' + c.primaryKey : ''}</span>
            </div>
            <div class="cfg-item-actions">
                <button class="cfg-btn cfg-edit-btn" data-key="${key}" data-type="instr">Edit</button>
                ${c.fixed ? '' : `<button class="cfg-btn cfg-del-btn" data-key="${key}" data-type="instr">Delete</button>`}
            </div>
        </div>
    `; }).join('');
}

function _renderModList() {
    const el = document.getElementById('cfgModList');
    if (!el) return;
    const cfg     = getModules();
    const entries = Object.entries(cfg);

    if (entries.length === 0) {
        el.innerHTML = '<div class="cfg-empty">No modules. Click "+ Add" to create one.</div>';
        return;
    }
    el.innerHTML = entries.map(([key, c]) => `
        <div class="cfg-item">
            <i class="${c.icon || 'fas fa-cube'} cfg-item-icon"></i>
            <div class="cfg-item-info">
                <span class="cfg-item-label">${c.label || key}</span>
                <span class="cfg-item-key">${key} &middot; ${(c.fields || []).length} field${(c.fields || []).length !== 1 ? 's' : ''}</span>
            </div>
            <div class="cfg-item-actions">
                <button class="cfg-btn cfg-edit-btn" data-key="${key}" data-type="mod">Edit</button>
                <button class="cfg-btn cfg-del-btn"  data-key="${key}" data-type="mod">Delete</button>
            </div>
        </div>
    `).join('');
}

// ── Modal ─────────────────────────────────────────────────────────

function _updateConnInputs(type) {
    const ipEl  = document.getElementById('cfgConnIp');
    const usbEl = document.getElementById('cfgConnUsb');
    if (ipEl)  ipEl.style.display  = type === 'ip'  ? '' : 'none';
    if (usbEl) usbEl.style.display = type === 'usb' ? '' : 'none';
}

function _openModal(mode, key = null) {
    _editMode = mode;
    _editKey  = key;

    const isInstr = mode === 'instr';
    document.getElementById('cfgModalTitle').textContent =
        key ? `Edit ${isInstr ? 'Instrument' : 'Module'}`
            : `Add ${isInstr ? 'Instrument' : 'Module'}`;

    const keyIn = document.getElementById('cfgKey');
    keyIn.disabled = !!key;

    const pkGrp = document.getElementById('cfgPrimaryKeyGroup');
    if (pkGrp) pkGrp.style.display = isInstr ? '' : 'none';

    // Connection section — instruments only
    const connGrp = document.getElementById('cfgConnGroup');
    if (connGrp) connGrp.style.display = isInstr ? '' : 'none';

    if (key) {
        const cfg   = isInstr ? getDynInstruments() : getModules();
        const entry = cfg[key] || {};
        keyIn.value = key;
        document.getElementById('cfgLabel').value      = entry.label      || '';
        document.getElementById('cfgIcon').value       = entry.icon       || '';
        document.getElementById('cfgPrimaryKey').value = entry.primaryKey || '';
        _renderFields(entry.fields || []);

        if (isInstr) {
            const conn = entry.connection || {};
            const type = conn.type || 'none';
            document.querySelectorAll('[name="cfgConnType"]').forEach(r => { r.checked = r.value === type; });
            document.getElementById('cfgConnIp').value  = conn.ip  || '';
            document.getElementById('cfgConnUsb').value = conn.usb || '';
            _updateConnInputs(type);
        }
    } else {
        keyIn.value = '';
        document.getElementById('cfgLabel').value      = '';
        document.getElementById('cfgIcon').value       = isInstr ? 'fas fa-gauge' : 'fas fa-cube';
        document.getElementById('cfgPrimaryKey').value = '';
        _renderFields([]);

        if (isInstr) {
            document.querySelectorAll('[name="cfgConnType"]').forEach(r => { r.checked = r.value === 'none'; });
            document.getElementById('cfgConnIp').value  = '';
            document.getElementById('cfgConnUsb').value = '';
            _updateConnInputs('none');
        }
    }

    document.getElementById('cfgModal').style.display = 'flex';
    setTimeout(() => (key ? document.getElementById('cfgLabel') : keyIn).focus(), 40);
}

function _closeModal() {
    document.getElementById('cfgModal').style.display = 'none';
    _editMode = null;
    _editKey  = null;
}

// ── Fields list in modal ──────────────────────────────────────────

function _renderFields(fields) {
    const el = document.getElementById('cfgFieldsList');
    if (!el) return;
    el.innerHTML = '';
    fields.forEach(f => _appendFieldRow(f));
}

function _appendFieldRow(f = {}) {
    const el = document.getElementById('cfgFieldsList');
    if (!el) return;

    const row       = document.createElement('div');
    row.className   = 'cfg-field-row';
    const isDT      = f.type === 'datetime';
    const onChart   = !isDT && (f.chart !== false);   // default true for non-datetime
    const defColor  = f.color || PALETTE[el.children.length % PALETTE.length];

    row.innerHTML = `
        <input class="cfg-fi cfg-fi-key"  type="text"   placeholder="key"   value="${_esc(f.key   || '')}">
        <input class="cfg-fi cfg-fi-lbl"  type="text"   placeholder="label" value="${_esc(f.label || '')}">
        <input class="cfg-fi cfg-fi-unit" type="text"   placeholder="unit"  value="${_esc(f.unit  || '')}">
        <input class="cfg-fi cfg-fi-dec"  type="number" placeholder="0-9"   value="${f.decimals ?? ''}" min="0" max="9">
        <label class="cfg-fi-dt-label" title="Datetime — shown in footer, not on chart">
            <input type="checkbox" class="cfg-fi-dt" ${isDT ? 'checked' : ''}> DT
        </label>
        <label class="cfg-fi-chart-label" title="Show as a line on the trend chart">
            <input type="checkbox" class="cfg-fi-chart" ${onChart ? 'checked' : ''} ${isDT ? 'disabled' : ''}> Chart
        </label>
        <input class="cfg-fi-color" type="color" value="${defColor}"
               title="Trend chart line colour"
               ${(!onChart || isDT) ? 'disabled' : ''}>
        <button class="cfg-del-field-btn" title="Remove field">&times;</button>
    `;

    const dtCb    = row.querySelector('.cfg-fi-dt');
    const chartCb = row.querySelector('.cfg-fi-chart');
    const colorIn = row.querySelector('.cfg-fi-color');

    dtCb.addEventListener('change', () => {
        if (dtCb.checked) {
            chartCb.checked  = false;
            chartCb.disabled = true;
            colorIn.disabled = true;
        } else {
            chartCb.disabled = false;
            colorIn.disabled = !chartCb.checked;
        }
    });
    chartCb.addEventListener('change', () => {
        colorIn.disabled = !chartCb.checked;
    });

    row.querySelector('.cfg-del-field-btn').addEventListener('click', () => row.remove());
    el.appendChild(row);
}

function _esc(str) {
    return String(str).replace(/"/g, '&quot;');
}

function _collectFields() {
    return Array.from(document.querySelectorAll('#cfgFieldsList .cfg-field-row'))
        .map(row => {
            const key        = row.querySelector('.cfg-fi-key').value.trim();
            const label      = row.querySelector('.cfg-fi-lbl').value.trim();
            const unit       = row.querySelector('.cfg-fi-unit').value.trim();
            const decRaw     = row.querySelector('.cfg-fi-dec').value;
            const decimals   = decRaw !== '' ? parseInt(decRaw, 10) : undefined;
            const isDatetime = row.querySelector('.cfg-fi-dt').checked;
            const onChart    = row.querySelector('.cfg-fi-chart').checked;
            const color      = row.querySelector('.cfg-fi-color').value;

            const field = { key, label };
            if (unit)                   field.unit     = unit;
            if (decimals !== undefined) field.decimals = decimals;
            if (isDatetime) {
                field.type = 'datetime';
            } else {
                field.chart = onChart;
                if (onChart && color) field.color = color;
            }
            return field;
        })
        .filter(f => f.key);
}

function _saveModal() {
    const rawKey = document.getElementById('cfgKey').value.trim();
    if (!rawKey) { _shake('cfgKey'); return; }
    // Normalise: spaces → underscores, lowercase
    const key = rawKey.replace(/\s+/g, '_').toLowerCase();

    const entry = {
        label:  document.getElementById('cfgLabel').value.trim() || key,
        icon:   document.getElementById('cfgIcon').value.trim()  || (_editMode === 'instr' ? 'fas fa-gauge' : 'fas fa-cube'),
        fields: _collectFields(),
    };

    if (_editMode === 'instr') {
        // Preserve fixed flag — user cannot add/remove it via UI
        const existing = getDynInstruments();
        if (existing[key]?.fixed) entry.fixed = true;

        entry.primaryKey = document.getElementById('cfgPrimaryKey').value.trim()
            || entry.fields.find(f => f.type !== 'datetime')?.key
            || '';

        const connType = document.querySelector('[name="cfgConnType"]:checked')?.value || 'none';
        if (connType === 'ip') {
            entry.connection = { type: 'ip', ip: document.getElementById('cfgConnIp').value.trim() };
        } else if (connType === 'usb') {
            entry.connection = { type: 'usb', usb: document.getElementById('cfgConnUsb').value.trim() };
        } else {
            entry.connection = { type: null };
        }

        upsertDynInstrument(key, entry);
        // Remove stale DOM so elements rebuild with new config when next data arrives
        _removeDynInstrDom(_editKey || key);
        _renderInstrList();
    } else {
        upsertModule(key, entry);
        _removeModDom(_editKey || key);
        _renderModList();
    }

    _closeModal();
}

function _shake(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('cfg-shake');
    void el.offsetWidth;
    el.classList.add('cfg-shake');
    el.focus();
}

// ── DOM cleanup ───────────────────────────────────────────────────
// Remove elements so they get rebuilt with fresh config on next data

function _removeDynInstrDom(key) {
    if (!key) return;
    document.getElementById(`dyn-fp-${key}`)?.remove();
    document.getElementById(`trend-dyn-card-${key}`)?.remove();
    // Hide dyn row if empty
    const row = document.getElementById('dynInstrumentsRow');
    if (row && row.children.length === 0) row.style.display = 'none';
}

function _removeModDom(key) {
    if (!key) return;
    document.getElementById(`module-tile-${key}`)?.remove();
    document.getElementById(`trend-card-${key}`)?.remove();
    // Show placeholder if no tiles left
    const container = document.getElementById('modulesContainer');
    if (container && container.children.length === 0) {
        container.innerHTML = `
            <div class="module-placeholder">
                <i class="fas fa-satellite-dish"></i>
                <p>Waiting for data...</p>
            </div>`;
    }
}

// ── Delete ────────────────────────────────────────────────────────

function _deleteItem(type, key) {
    const noun = type === 'instr' ? 'instrument' : 'module';
    if (!confirm(`Delete "${key}"?\n\nIts faceplate and trend card will be removed. Data will stop appearing until a new entry is created.`)) return;

    if (type === 'instr') {
        removeDynInstrument(key);
        _removeDynInstrDom(key);
        _renderInstrList();
    } else {
        removeModule(key);
        _removeModDom(key);
        _renderModList();
    }
}

// ── Public init ───────────────────────────────────────────────────

// ── Theme section ─────────────────────────────────────────────────

function _renderThemeGrid() {
    const grid = document.getElementById('cfgThemeGrid');
    if (!grid) return;
    const current = getTheme();
    grid.innerHTML = THEMES.map(t => `
        <div class="cfg-theme-card${t.id === current ? ' active' : ''}" data-theme-id="${t.id}">
            <div class="cfg-theme-swatches">
                ${t.swatches.map(c => `<div class="cfg-theme-swatch" style="background:${c}"></div>`).join('')}
            </div>
            <span class="cfg-theme-name">${t.label}</span>
        </div>
    `).join('');
}

export function initConfigTab() {
    // Theme grid
    _renderThemeGrid();
    document.getElementById('cfgThemeGrid')?.addEventListener('click', e => {
        const card = e.target.closest('.cfg-theme-card');
        if (!card) return;
        applyTheme(card.dataset.themeId);
        _renderThemeGrid();
    });

    // Connection type radio buttons
    document.querySelectorAll('[name="cfgConnType"]').forEach(r => {
        r.addEventListener('change', () => _updateConnInputs(r.value));
    });

    // Add buttons
    document.getElementById('cfgAddInstrBtn')?.addEventListener('click', () => _openModal('instr'));
    document.getElementById('cfgAddModBtn')  ?.addEventListener('click', () => _openModal('mod'));

    // Modal controls
    document.getElementById('cfgModalClose') ?.addEventListener('click', _closeModal);
    document.getElementById('cfgModalCancel')?.addEventListener('click', _closeModal);
    document.getElementById('cfgModalSave')  ?.addEventListener('click', _saveModal);
    document.getElementById('cfgAddField')   ?.addEventListener('click', () => _appendFieldRow());

    // Close on backdrop click
    document.getElementById('cfgModal')?.addEventListener('click', e => {
        if (e.target.id === 'cfgModal') _closeModal();
    });

    // Keyboard: Escape closes
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && document.getElementById('cfgModal')?.style.display !== 'none') {
            _closeModal();
        }
        if (e.key === 'Enter' && e.ctrlKey && document.getElementById('cfgModal')?.style.display !== 'none') {
            _saveModal();
        }
    });

    // Delegated edit/delete on instrument list
    document.getElementById('cfgInstrList')?.addEventListener('click', e => {
        const btn = e.target.closest('.cfg-edit-btn, .cfg-del-btn');
        if (!btn) return;
        const key = btn.dataset.key;
        if (btn.classList.contains('cfg-edit-btn')) _openModal('instr', key);
        if (btn.classList.contains('cfg-del-btn'))  _deleteItem('instr', key);
    });

    // Delegated edit/delete on module list
    document.getElementById('cfgModList')?.addEventListener('click', e => {
        const btn = e.target.closest('.cfg-edit-btn, .cfg-del-btn');
        if (!btn) return;
        const key = btn.dataset.key;
        if (btn.classList.contains('cfg-edit-btn')) _openModal('mod', key);
        if (btn.classList.contains('cfg-del-btn'))  _deleteItem('mod', key);
    });

    // Reset to factory defaults
    document.getElementById('cfgResetBtn')?.addEventListener('click', () => {
        if (!confirm('Reset all instruments and modules to factory defaults?\n\nAll custom entries will be removed. This cannot be undone.')) return;
        resetDefaults();

        // Remove all dynamic DOM elements
        document.querySelectorAll('[id^="dyn-fp-"]')         .forEach(el => el.remove());
        document.querySelectorAll('[id^="trend-dyn-card-"]') .forEach(el => el.remove());
        document.querySelectorAll('[id^="module-tile-"]')    .forEach(el => el.remove());
        document.querySelectorAll('[id^="trend-card-"]')     .forEach(el => el.remove());

        const dynRow = document.getElementById('dynInstrumentsRow');
        if (dynRow) dynRow.style.display = 'none';

        const container = document.getElementById('modulesContainer');
        if (container) container.innerHTML = `
            <div class="module-placeholder">
                <i class="fas fa-satellite-dish"></i>
                <p>Waiting for data...</p>
            </div>`;

        renderConfigLists();
    });

    // Initial render
    renderConfigLists();
}
