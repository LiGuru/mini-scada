/**
 * gui/views/instr-control.js
 *
 * Instrument browser drawer.
 * Shows all discovered instruments, their live status and reservation state.
 * Clicking "Open Panel" launches a floating instrument control panel.
 */

import { openPanel, updatePanelData, handlePanelReply, panelTokens } from './instr-panel.js';

const api = window.electronAPI;

// ── Registry ──────────────────────────────────────────────────────────────────
// Key: `${agent_id}::${instr_id}`

const _registry = new Map();

// ── DOM refs ──────────────────────────────────────────────────────────────────

let _drawer, _backdrop, _toggleBtn, _body, _badge;

// ── Init ──────────────────────────────────────────────────────────────────────

export function initInstrControl() {
    _drawer    = document.getElementById('icDrawer');
    _backdrop  = document.getElementById('icBackdrop');
    _toggleBtn = document.getElementById('icToggleBtn');
    _body      = document.getElementById('icDrawerBody');
    _badge     = document.getElementById('icToggleBadge');

    if (!_drawer) return;

    document.getElementById('icDrawerClose')?.addEventListener('click', _close);
    _backdrop.addEventListener('click', _close);
    _toggleBtn?.addEventListener('click', _toggle);

    api?.onInstrReg?.(   _onReg);
    api?.onInstrData?.(  _onData);
    api?.onInstrReply?.( _onReply);

    setInterval(_pruneStale, 30_000);
}

// ── AMQP callbacks ────────────────────────────────────────────────────────────

function _onReg(data) {
    const key = _key(data.agent_id, data.instr_id);
    _registry.set(key, { ...(_registry.get(key) || {}), ...data, _seenAt: Date.now() });
    _updateBadge();
    _render();
}

function _onData(data) {
    const key = _key(data.agent_id, data.instr_id);
    const entry = _registry.get(key);
    if (entry) {
        entry.lastData = data.data;
        entry._seenAt  = Date.now();
    }
    updatePanelData(key, data.data);

    // Update the inline data summary in the drawer card if it's expanded
    const summaryEl = document.getElementById(`ic-summary-${_sid(key)}`);
    if (summaryEl && data.data) summaryEl.textContent = _dataSummary(data.data);
}

function _onReply(data) {
    // Forward to panel first; if panel handles it, skip drawer processing
    if (handlePanelReply(data)) return;
}

// ── Render ────────────────────────────────────────────────────────────────────

function _render() {
    if (!_body) return;
    if (!_registry.size) {
        _body.innerHTML = `
            <div class="ic-empty">
                <i class="fas fa-satellite-dish"></i>
                <span>No instrument runners detected</span>
                <span style="font-size:11px;opacity:.6">Start instr_runner.py</span>
            </div>`;
        return;
    }

    const byAgent = new Map();
    for (const [key, entry] of _registry) {
        const list = byAgent.get(entry.agent_id) || [];
        list.push({ key, entry });
        byAgent.set(entry.agent_id, list);
    }

    const frag = document.createDocumentFragment();

    for (const [agentId, items] of byAgent) {
        const h = document.createElement('div');
        h.className = 'ic-agent-heading';
        h.innerHTML = `<i class="fas fa-server"></i> ${_esc(agentId)}`;
        frag.appendChild(h);

        for (const { key, entry } of items) {
            frag.appendChild(_buildCard(key, entry));
        }
    }

    _body.innerHTML = '';
    _body.appendChild(frag);
}

function _buildCard(key, entry) {
    const mine   = panelTokens.has(key);
    const taken  = entry.reserved && !mine;
    const free   = !entry.reserved;

    const dotCls   = mine ? 'mine' : taken ? 'taken' : 'free';
    const badgeTxt = mine ? 'mine' : taken ? `held` : 'free';
    const sid = _sid(key);

    const card = document.createElement('div');
    card.className = 'ic-card';
    card.innerHTML = `
        <div class="ic-card-header">
            <div class="ic-dot ${dotCls}"></div>
            <div class="ic-card-info">
                <div class="ic-card-id">${_esc(entry.instr_id)}</div>
                <div class="ic-card-model">${_esc(entry.model || '—')}</div>
            </div>
            <span class="ic-reservation-badge ${dotCls}">${badgeTxt}</span>
            <button class="ic-open-btn" data-key="${_esc(key)}">
                <i class="fas fa-external-link-alt"></i> Panel
            </button>
        </div>
        <div class="ic-data-row" id="ic-summary-${sid}">
            ${_dataSummary(entry.lastData)}
        </div>`;

    card.querySelector('.ic-open-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        openPanel(key, entry);
    });

    return card;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _dataSummary(data) {
    if (!data || typeof data !== 'object') return '—';
    return Object.entries(data)
        .filter(([k]) => k !== 'measured_at' && k !== 'error')
        .slice(0, 4)
        .map(([k, v]) => {
            if (typeof v === 'boolean') return `${k}: ${v ? 'ON' : 'OFF'}`;
            if (typeof v === 'number')  return `${k}: ${v}`;
            return `${k}: ${v}`;
        })
        .join('  ');
}

function _updateBadge() {
    if (!_badge) return;
    const n = _registry.size;
    _badge.textContent = n;
    _badge.style.display = n ? '' : 'none';
}

function _pruneStale() {
    const cut = Date.now() - 45_000;
    let changed = false;
    for (const [key, e] of _registry) {
        if ((e._seenAt || 0) < cut) { _registry.delete(key); changed = true; }
    }
    if (changed) { _updateBadge(); _render(); }
}

function _key(a, i) { return `${a}::${i}`; }
function _sid(k)    { return k.replace(/[^a-zA-Z0-9]/g, '_'); }
function _esc(s)    { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

let _open = false;
function _close()  { _open = false; _drawer.classList.remove('open'); _backdrop.classList.remove('visible'); _toggleBtn?.classList.remove('active'); }
function _toggle() { _open ? _close() : _openDrawer(); }
function _openDrawer() { _open = true; _drawer.classList.add('open'); _backdrop.classList.add('visible'); _toggleBtn?.classList.add('active'); _render(); }
