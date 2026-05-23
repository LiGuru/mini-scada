import { formatDate, roundValue } from '../utils/helpers.js';

/**
 * Creates or updates a module tile in #modulesContainer.
 *
 * @param {string}      moduleKey  - Key from details object (e.g. "eps", "uhf")
 * @param {object}      data       - Measurement payload for this module
 * @param {object|null} config     - Entry from MODULE_CONFIG, or null for generic render
 */
export function updateModuleCard(moduleKey, data, config) {
    const container = document.getElementById('modulesContainer');
    if (!container) return;

    // Remove placeholder on first real tile
    const placeholder = container.querySelector('.module-placeholder');
    if (placeholder) placeholder.remove();

    let tile = document.getElementById(`module-tile-${moduleKey}`);

    if (!tile) {
        tile = _createTile(moduleKey, config);
        container.appendChild(tile);
    }

    _updateTile(tile, moduleKey, data, config);

    // Flash animation
    tile.classList.remove('tile-updated');
    void tile.offsetWidth; // force reflow
    tile.classList.add('tile-updated');
}

// ------------------------------------------------------------------
// Private helpers
// ------------------------------------------------------------------

function _createTile(moduleKey, config) {
    const tile  = document.createElement('div');
    tile.id        = `module-tile-${moduleKey}`;
    tile.className = 'module-tile';

    const icon  = config?.icon  || 'fas fa-cube';
    const label = config?.label || moduleKey.toUpperCase();

    tile.innerHTML = `
        <div class="tile-header">
            <div class="tile-header-left">
                <i class="${icon}"></i>
                <span class="tile-name">${label}</span>
            </div>
            <div class="badge ok" id="tile-badge-${moduleKey}">OK</div>
        </div>
        <div class="tile-body" id="tile-body-${moduleKey}"></div>
        <div class="tile-footer">
            <span id="tile-ts-${moduleKey}">—</span>
            <span class="na">${moduleKey}</span>
        </div>
    `;
    return tile;
}

function _updateTile(tile, moduleKey, data, config) {
    const body = document.getElementById(`tile-body-${moduleKey}`);
    const tsEl = document.getElementById(`tile-ts-${moduleKey}`);

    if (body) {
        if (config?.fields) {
            // Render configured fields, skip datetime fields (shown in footer)
            const displayFields = config.fields.filter(f => f.type !== 'datetime');
            body.innerHTML = displayFields.map(field => `
                <div class="tile-kv">
                    <span class="tile-key">${field.label}</span>
                    <span class="tile-val">${_renderValue(data[field.key], field)}</span>
                </div>
            `).join('');
        } else {
            // Generic fallback: render all non-timestamp key-value pairs
            body.innerHTML = Object.entries(data)
                .filter(([k]) => !k.endsWith('_at'))
                .map(([k, v]) => `
                    <div class="tile-kv">
                        <span class="tile-key">${k}</span>
                        <span class="tile-val">${_renderValue(v, { decimals: 3 })}</span>
                    </div>
                `).join('');
        }
    }

    // Update timestamp in footer
    if (tsEl && data.measured_at) {
        const d = new Date(data.measured_at);
        tsEl.textContent = isNaN(d.getTime())
            ? data.measured_at
            : d.toLocaleTimeString('en-GB', { hour12: false });
    }
}

function _renderValue(value, field) {
    if (value === undefined || value === null) return '<span class="na">n/a</span>';
    if (field.type === 'datetime') return `<span>${formatDate(value)}</span>`;
    const rounded = roundValue(value, field.decimals ?? 2);
    const unit    = field.unit ? `<span class="unit"> ${field.unit}</span>` : '';
    return `${rounded}${unit}`;
}
