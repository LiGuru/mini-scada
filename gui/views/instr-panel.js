/**
 * gui/views/instr-panel.js
 *
 * Floating, draggable instrument control panels.
 * Each instrument gets one panel; multiple can be open simultaneously.
 * Panels are styled like physical front panels (dark, VFD display, 3-D buttons).
 */

const api = window.electronAPI;

// ── State ─────────────────────────────────────────────────────────────────────

/** Map<instrKey, HTMLElement> */
const _panels = new Map();

/** Map<correlation_id, {resolve, key}> */
const _pending = new Map();

/** Map<instrKey, token> — reservations held by this GUI session */
export const panelTokens = new Map();

let _container = null;
let _zBase = 500;
let _staggerN = 0;

// ── Init ──────────────────────────────────────────────────────────────────────

export function initInstrPanels() {
    _container = document.getElementById('ipContainer');
}

// ── Open / focus / close ──────────────────────────────────────────────────────

export function openPanel(key, entry) {
    if (_panels.has(key)) {
        _panels.get(key).style.zIndex = ++_zBase;
        return;
    }
    const panel = _buildPanel(key, entry);
    _container.appendChild(panel);
    _panels.set(key, panel);
}

export function closePanel(key) {
    _panels.get(key)?.remove();
    _panels.delete(key);
}

// ── Live data update (called from instr-control.js) ───────────────────────────

export function updatePanelData(key, data) {
    const disp = _panels.get(key)?.querySelector('.ip-display');
    if (disp) _renderDisplay(disp, data);
}

// ── Reply handling (called from instr-control.js _onReply) ───────────────────

export function handlePanelReply(data) {
    const p = _pending.get(data.correlation_id);
    if (!p) return false;
    _pending.delete(data.correlation_id);
    p.resolve(data);
    return true;
}

// ── Panel build ───────────────────────────────────────────────────────────────

function _buildPanel(key, entry) {
    const { left, top } = _staggerPos();

    const panel = document.createElement('div');
    panel.className = 'ip-panel';
    panel.style.cssText = `left:${left}px;top:${top}px;z-index:${++_zBase}`;
    panel.dataset.key = key;

    panel.innerHTML = _panelHTML(key, entry);
    _wire(panel, key, entry);
    _makeDraggable(panel, panel.querySelector('.ip-header'));
    panel.addEventListener('mousedown', () => { panel.style.zIndex = ++_zBase; }, true);

    return panel;
}

function _panelHTML(key, entry) {
    const mine = panelTokens.has(key);
    const ledCls = mine ? 'ip-led--mine' : 'ip-led--free';
    const sid = _sid(key);

    return `
        <div class="ip-header">
            <div class="ip-header-left">
                <div class="ip-status-led ${ledCls}" id="ip-led-${sid}"></div>
                <div class="ip-title-block">
                    <span class="ip-instr-id">${_esc(entry.instr_id)}</span>
                    <span class="ip-model">${_esc(entry.model || '')}</span>
                </div>
            </div>
            <div class="ip-header-right">
                ${_reserveBtn(key)}
                <button class="ip-hdr-btn ip-hdr-btn--close" data-close>✕</button>
            </div>
        </div>

        <div class="ip-display" id="ip-disp-${sid}">
            <div class="ip-display-placeholder">Waiting for data…</div>
        </div>

        <div class="ip-controls${mine ? '' : ' ip-controls--locked'}" id="ip-ctrl-${sid}">
            ${_buildControls(entry.capabilities || {})}
        </div>

        <div class="ip-result" id="ip-result-${sid}" style="display:none"></div>`;
}

function _reserveBtn(key) {
    if (panelTokens.has(key)) {
        return `<button class="ip-hdr-btn ip-hdr-btn--release" data-action="release">Release</button>`;
    }
    return `<button class="ip-hdr-btn ip-hdr-btn--reserve" data-action="reserve">Reserve</button>`;
}

// ── Controls builder ──────────────────────────────────────────────────────────

function _buildControls(caps) {
    const keys = Object.keys(caps);
    if (!keys.length) return '<div class="ip-no-caps">No commands</div>';

    const pairs = _findOnOffPairs(caps);
    const done  = new Set();
    let html = '';

    for (const cmd of keys) {
        if (done.has(cmd)) continue;
        const partner = pairs.get(cmd);

        if (partner) {
            // ON/OFF pair — side by side toggle buttons
            const label = cmd.replace(/_on$/, '').replace(/_/g, ' ').toUpperCase();
            html += `
            <div class="ip-ctrl-row ip-ctrl-pair">
                <span class="ip-ctrl-label">${label}</span>
                <div class="ip-ctrl-pair-btns">
                    <button class="ip-btn ip-btn--toggle" data-send="${_esc(cmd)}">ON</button>
                    <button class="ip-btn ip-btn--toggle" data-send="${_esc(partner)}">OFF</button>
                </div>
            </div>`;
            done.add(cmd); done.add(partner);

        } else if (!Object.keys(caps[cmd]).length) {
            // No-arg action button
            html += `
            <div class="ip-ctrl-row">
                <button class="ip-btn ip-btn--wide" data-send="${_esc(cmd)}">
                    ${cmd.replace(/_/g, ' ').toUpperCase()}
                </button>
            </div>`;
            done.add(cmd);

        } else {
            // Command with args
            const argRows = Object.entries(caps[cmd]).map(([arg, hint]) => `
                <div class="ip-ctrl-arg">
                    <label class="ip-arg-label" title="${_esc(hint)}">${_esc(arg)}</label>
                    <input class="ip-arg-input"
                        data-cmd="${_esc(cmd)}" data-arg="${_esc(arg)}"
                        placeholder="${_esc(_placeholder(hint))}"
                        title="${_esc(hint)}">
                </div>`).join('');

            html += `
            <div class="ip-ctrl-row ip-ctrl-row--args">
                <span class="ip-ctrl-label">${cmd.replace(/_/g, ' ').toUpperCase()}</span>
                <div class="ip-ctrl-body">
                    ${argRows}
                    <button class="ip-btn ip-btn--send" data-send="${_esc(cmd)}">SEND</button>
                </div>
            </div>`;
            done.add(cmd);
        }
    }
    return html;
}

// ── Display renderer ──────────────────────────────────────────────────────────

function _renderDisplay(el, data) {
    const entries = Object.entries(data).filter(([k]) => k !== 'measured_at' && k !== 'error');
    if (!entries.length) return;

    el.innerHTML = entries.map(([k, v]) => {
        const { val, unit } = _fmtValue(k, v);
        const isBool = typeof v === 'boolean';
        const cls    = isBool ? (v ? 'ip-tile--on' : 'ip-tile--off')
                              : typeof v === 'number' ? 'ip-tile--num' : 'ip-tile--str';
        return `
            <div class="ip-tile ${cls}">
                <div class="ip-tile-label">${_keyLabel(k)}</div>
                <div class="ip-tile-value">${_esc(val)}</div>
                ${unit ? `<div class="ip-tile-unit">${_esc(unit)}</div>` : ''}
            </div>`;
    }).join('');
}

// ── Event wiring ──────────────────────────────────────────────────────────────

function _wire(panel, key, entry) {
    panel.addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-send],[data-action],[data-close]');
        if (!btn) return;
        e.stopPropagation();

        if ('close' in btn.dataset) {
            closePanel(key);
            return;
        }

        if ('action' in btn.dataset) {
            btn.disabled = true;
            if (btn.dataset.action === 'reserve') await _doReserve(key, entry, panel);
            else                                   await _doRelease(key, entry, panel);
            btn.disabled = false;
            return;
        }

        if ('send' in btn.dataset) {
            if (!panelTokens.has(key)) {
                _showResult(key, false, 'Reserve the instrument first');
                return;
            }
            btn.disabled = true;
            const cmd  = btn.dataset.send;
            const args = _collectArgs(panel, cmd);
            const rep  = await _cmd(key, entry, { action: 'execute', token: panelTokens.get(key), cmd, args });
            _showResult(key, rep?.ok ?? false, rep?.result ?? '');
            btn.disabled = false;
        }
    });
}

// ── Commands ──────────────────────────────────────────────────────────────────

async function _doReserve(key, entry, panel) {
    const rep = await _cmd(key, entry, { action: 'reserve' });
    if (rep?.ok && rep.token) {
        panelTokens.set(key, rep.token);
        _syncPanel(panel, key);
        _showResult(key, true, 'Reserved');
    } else {
        _showResult(key, false, rep?.result ?? 'Failed');
    }
}

async function _doRelease(key, entry, panel) {
    const token = panelTokens.get(key);
    if (!token) return;
    const rep = await _cmd(key, entry, { action: 'release', token });
    if (rep?.ok) {
        panelTokens.delete(key);
        _syncPanel(panel, key);
        _showResult(key, true, 'Released');
    } else {
        _showResult(key, false, rep?.result ?? 'Failed');
    }
}

async function _cmd(key, entry, payload) {
    const corrId = _randomId();
    const promise = new Promise((resolve) => {
        _pending.set(corrId, { resolve, key });
        setTimeout(() => {
            if (_pending.has(corrId)) { _pending.delete(corrId); resolve({ ok: false, result: 'Timeout' }); }
        }, 10_000);
    });
    await api?.sendInstrCmd?.({ agent_id: entry.agent_id, instr_id: entry.instr_id, ...payload, correlation_id: corrId });
    return promise;
}

function _collectArgs(panel, cmd) {
    const args = {};
    panel.querySelectorAll(`.ip-arg-input[data-cmd="${cmd}"]`).forEach((inp) => {
        const raw = inp.value.trim();
        if (!raw) return;
        const n = Number(raw);
        args[inp.dataset.arg] = isNaN(n) ? raw : n;
    });
    return args;
}

// ── Panel state sync ──────────────────────────────────────────────────────────

function _syncPanel(panel, key) {
    const mine = panelTokens.has(key);

    // Swap reserve/release button
    const right = panel.querySelector('.ip-header-right');
    if (right) {
        const closeHTML = right.querySelector('[data-close]').outerHTML;
        right.innerHTML = _reserveBtn(key) + closeHTML;
    }

    // Lock/unlock controls
    panel.querySelector('.ip-controls')?.classList.toggle('ip-controls--locked', !mine);

    // Update LED
    const led = panel.querySelector('.ip-status-led');
    if (led) led.className = `ip-status-led ${mine ? 'ip-led--mine' : 'ip-led--free'}`;
}

function _showResult(key, ok, text) {
    const el = document.getElementById(`ip-result-${_sid(key)}`);
    if (!el) return;
    el.style.display = 'block';
    el.className = `ip-result ${ok ? 'ip-result--ok' : 'ip-result--err'}`;
    el.textContent = text;
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.style.display = 'none'; }, 6000);
}

// ── Drag ──────────────────────────────────────────────────────────────────────

function _makeDraggable(panel, handle) {
    handle.addEventListener('mousedown', (e) => {
        if (e.target.closest('button')) return;
        const startX = e.clientX, startY = e.clientY;
        const r = panel.getBoundingClientRect();
        let l = r.left, t = r.top;
        panel.style.transition = 'none';

        const onMove = (e) => {
            l = Math.max(0, Math.min(window.innerWidth  - 60, l + e.movementX));
            t = Math.max(0, Math.min(window.innerHeight - 40, t + e.movementY));
            panel.style.left = l + 'px';
            panel.style.top  = t + 'px';
        };
        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup',  onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup',  onUp);
        e.preventDefault();
    });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _staggerPos() {
    const n = _staggerN++ % 8;
    return { left: 80 + n * 36, top: 80 + n * 36 };
}

function _findOnOffPairs(caps) {
    const pairs = new Map();
    for (const k of Object.keys(caps)) {
        if (k.endsWith('_on')) {
            const off = k.slice(0, -3) + '_off';
            if (off in caps) { pairs.set(k, off); pairs.set(off, k); }
        }
    }
    return pairs;
}

function _fmtValue(key, val) {
    if (typeof val === 'boolean') return { val: val ? 'ON' : 'OFF', unit: '' };
    if (typeof val === 'number') {
        const unit = _unitFor(key);
        const dec  = /freq|span/.test(key)          ? 3
                   : /power|pow|dbm/.test(key)       ? 2
                   : /resist/.test(key)              ? 2
                   : /current|curr/.test(key)        ? 4
                   : /voltage|volt|ampl/.test(key)   ? 4
                   : /^q[0-3]$/.test(key)            ? 4  // quaternion
                   : /_rps$/.test(key)               ? 4  // rad/s
                   : /_rpm$/.test(key)               ? 0  // RPM integer
                   : /_ut$/.test(key)                ? 2  // µT
                   : 3;
        return { val: val.toFixed(dec), unit };
    }
    return { val: String(val), unit: '' };
}

function _unitFor(k) {
    if (/voltage|volt|ampl|vrms/.test(k))  return 'V';
    if (/current|curr/.test(k))             return 'A';
    if (/\bpower\b/.test(k) && !/peak/.test(k)) return 'W';
    if (/peak_power|dbm/.test(k))           return 'dBm';
    if (/freq/.test(k))                     return 'MHz';
    if (/resist/.test(k))                   return 'Ω';
    if (/period/.test(k))                   return 'μs';
    if (/span/.test(k))                     return 'MHz';
    // ADCS-specific
    if (/\b_rps\b|_rps$/.test(k))          return 'rad/s';
    if (/_rpm$/.test(k))                    return 'RPM';
    if (/_ut$/.test(k))                     return 'µT';
    if (/^q[0-3]$/.test(k))                return '';       // quaternion — no unit
    if (/sim_time/.test(k))                 return 's';
    return '';
}

function _keyLabel(k) {
    return k.replace(/_mhz$/i,'').replace(/_us$/i,'').replace(/_/g,' ')
            .toUpperCase().trim();
}

function _placeholder(hint) {
    if (!hint) return '';
    if (hint.startsWith('float')) return '0.0';
    if (hint.startsWith('int'))   return '1';
    if (hint.startsWith('bool'))  return 'true / false';
    if (hint.startsWith('str')) {
        const after = hint.includes('—') ? hint.split('—')[1].trim() : hint;
        return after.split('(')[0].trim().slice(0, 30);
    }
    return '';
}

function _sid(k)  { return k.replace(/[^a-zA-Z0-9]/g, '_'); }
function _esc(s)  { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function _randomId() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
