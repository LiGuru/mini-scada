import { roundValue } from '../utils/helpers.js?v=2';

// Keys in the instruments payload that are never instrument data
const SKIP = new Set(['agent_id', 'timestamp']);

/**
 * Returns true if this payload key represents an instrument (not metadata).
 */
export function isDynamic(key) {
    return !SKIP.has(key);
}

/**
 * Creates or updates a dynamic faceplate card in #dynInstrumentsRow.
 * Returns the faceplate element.
 */
export function upsertDynamicFaceplate(key, data, config) {
    const row = document.getElementById('dynInstrumentsRow');
    if (!row) return null;

    row.style.display = '';

    let fp = document.getElementById(`dyn-fp-${key}`);
    if (!fp) {
        fp = _buildFaceplate(key, config);
        row.appendChild(fp);
    }

    _updateReadings(key, data, config);
    return fp;
}

// ──────────────────────────────────────────────────────────────────

function _buildFaceplate(key, config) {
    const label = config?.label || key.replace(/_/g, ' ').toUpperCase();
    const icon  = config?.icon  || 'fas fa-gauge';

    const fp = document.createElement('div');
    fp.id        = `dyn-fp-${key}`;
    fp.className = 'faceplate';
    fp.innerHTML = `
        <div class="fp-header">
            <div class="fp-name"><i class="${icon}"></i> ${label.toUpperCase()}</div>
            <div class="badge idle" id="dyn-badge-${key}">IDLE</div>
        </div>
        <div class="fp-readings" id="dyn-readings-${key}"></div>
        <div class="fp-sparkline">
            <svg viewBox="0 0 200 24" preserveAspectRatio="none">
                <polyline id="dyn-spark-${key}" points=""/>
            </svg>
        </div>
    `;
    return fp;
}

function _updateReadings(key, data, config) {
    const el = document.getElementById(`dyn-readings-${key}`);
    if (!el) return;

    const fields = config?.fields?.filter(f => f.type !== 'datetime')
        ?? Object.keys(data)
             .filter(k => !k.endsWith('_at'))
             .map(k => ({ key: k, label: k, decimals: 3 }));

    el.innerHTML = fields.map(f => {
        const v = data[f.key];
        const display = (v !== undefined && v !== null) ? roundValue(v, f.decimals ?? 3) : '—';
        return `
            <div class="reading">
                <div class="reading-label">${f.label}</div>
                <div class="reading-value live">${display}</div>
                <div class="reading-unit">${f.unit || ''}</div>
            </div>`;
    }).join('');

    const badge = document.getElementById(`dyn-badge-${key}`);
    if (badge) { badge.className = 'badge ok'; badge.textContent = 'LIVE'; }
}
