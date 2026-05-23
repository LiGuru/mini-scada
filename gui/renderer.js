import { updateModuleCard }        from './instruments/module.js?v=2';
import { isDynamic, upsertDynamicFaceplate } from './instruments/dynamicInstrument.js?v=1';
import { getDynInstruments, getModules } from './instruments/configManager.js?v=2';
import { initConfigTab, renderConfigLists } from './config-ui.js?v=3';
import { formatDate }              from './utils/helpers.js?v=2';

const api = window.electronAPI;

// ══════════════════════════════════════════════════════════════════
// SPARKLINES (Live View faceplate mini-charts)
// ══════════════════════════════════════════════════════════════════

class Sparkline {
    constructor(polylineId, maxPoints = 50) {
        this.polylineId = polylineId;
        this.el         = document.getElementById(polylineId);
        this.points     = [];
        this.maxPoints  = maxPoints;
    }
    push(value) {
        // Re-query if faceplate was removed and rebuilt (config edit)
        if (!this.el?.isConnected) {
            this.el = document.getElementById(this.polylineId);
        }
        const n = parseFloat(value);
        if (isNaN(n)) return;
        this.points.push(n);
        if (this.points.length > this.maxPoints) this.points.shift();
        this._render();
    }
    _render() {
        if (this.points.length < 2 || !this.el) return;
        const min = Math.min(...this.points), max = Math.max(...this.points);
        const range = max - min || 1;
        const W = 200, H = 24, P = 3;
        const pts = this.points.map((v, i) => {
            const x = (i / (this.points.length - 1)) * W;
            const y = P + (1 - (v - min) / range) * (H - P * 2);
            return `${x.toFixed(1)},${y.toFixed(1)}`;
        });
        this.el.setAttribute('points', pts.join(' '));
    }
}

// All instrument sparklines created lazily, keyed by instrument key
const dynSparklines = {};
function getDynSparkline(key) {
    if (!dynSparklines[key]) dynSparklines[key] = new Sparkline(`dyn-spark-${key}`);
    return dynSparklines[key];
}

// ══════════════════════════════════════════════════════════════════
// TREND CHARTS (Trends tab — multi-series SVG line charts)
// ══════════════════════════════════════════════════════════════════

const TREND_COLORS = ['#00c896', '#00bcd4', '#f0a500', '#a78bfa', '#f472b6'];
const NS = 'http://www.w3.org/2000/svg';

class TrendChart {
    static MAX_POINTS = 120;

    /**
     * @param {string}   containerId  - ID of `.trend-chart-area` div
     * @param {object[]} series       - [{key, color, valId?}]  valId → span to update with latest value
     */
    constructor(containerId, series) {
        this.container = document.getElementById(containerId);
        this.series    = series;
        this.buffers   = {};
        this.polylines = {};
        series.forEach(s => { this.buffers[s.key] = []; });
        if (this.container) this._build();
    }

    _build() {
        const svg = document.createElementNS(NS, 'svg');
        svg.setAttribute('viewBox', '0 0 400 64');
        svg.setAttribute('preserveAspectRatio', 'none');
        svg.classList.add('trend-svg');
        this.svg = svg;

        this.gridG = document.createElementNS(NS, 'g');
        svg.appendChild(this.gridG);

        for (const s of this.series) {
            const pl = document.createElementNS(NS, 'polyline');
            pl.setAttribute('fill', 'none');
            pl.setAttribute('stroke', s.color);
            pl.setAttribute('stroke-width', '1.5');
            pl.setAttribute('opacity', '0.85');
            this.polylines[s.key] = pl;
            svg.appendChild(pl);
        }
        this.container.appendChild(svg);
    }

    push(data) {
        let updated = false;
        for (const s of this.series) {
            const v = parseFloat(data[s.key]);
            if (isNaN(v)) continue;
            this.buffers[s.key].push(v);
            if (this.buffers[s.key].length > TrendChart.MAX_POINTS) this.buffers[s.key].shift();
            if (s.valId) {
                const el = document.getElementById(s.valId);
                if (el) el.textContent = v.toFixed(s.decimals ?? 4);
            }
            updated = true;
        }
        if (updated) this.render();
    }

    render() {
        if (!this.svg) return;
        const W = 400, H = 64;

        // Global min/max across all series for a shared Y scale
        let all = [];
        for (const s of this.series) all = all.concat(this.buffers[s.key]);
        if (all.length === 0) return;

        let lo = Math.min(...all), hi = Math.max(...all);
        if (lo === hi) { lo -= 0.5; hi += 0.5; }
        const pad = (hi - lo) * 0.08 || 0.1;
        lo -= pad; hi += pad;
        const range = hi - lo;

        // Grid (3 horizontal lines at 25 / 50 / 75 %)
        this.gridG.innerHTML = '';
        [0.25, 0.5, 0.75].forEach(t => {
            const line = document.createElementNS(NS, 'line');
            line.setAttribute('x1', '0'); line.setAttribute('x2', String(W));
            const y = String(t * H);
            line.setAttribute('y1', y); line.setAttribute('y2', y);
            line.setAttribute('stroke', '#242b3d');
            line.setAttribute('stroke-width', '0.5');
            this.gridG.appendChild(line);
        });

        // Polylines
        for (const s of this.series) {
            const buf = this.buffers[s.key];
            if (buf.length < 2) { this.polylines[s.key]?.setAttribute('points', ''); continue; }
            const pts = buf.map((v, i) => {
                const x = (i / (buf.length - 1)) * W;
                const y = (1 - (v - lo) / range) * H;
                return `${x.toFixed(1)},${y.toFixed(1)}`;
            });
            this.polylines[s.key].setAttribute('points', pts.join(' '));
        }

        // Update timestamp
        const tsEl = document.getElementById('trendsLastUpdate');
        if (tsEl) tsEl.textContent = new Date().toLocaleTimeString('en-GB', { hour12: false });
    }
}

// ── Dynamic module trend charts ──────────────────────────────────

const moduleTrendCharts = {};

function getOrCreateModuleTrendChart(moduleKey, config) {
    // If cached but DOM removed (config edited) → discard and rebuild
    if (moduleTrendCharts[moduleKey] && !document.getElementById(`trend-card-${moduleKey}`)) {
        delete moduleTrendCharts[moduleKey];
    }
    if (moduleTrendCharts[moduleKey]) return moduleTrendCharts[moduleKey];

    const label = document.getElementById('trends-module-label');
    if (label) label.style.display = '';

    const container = document.getElementById('trends-module-cards');
    if (!container) return null;

    // Only fields with chart !== false (and not datetime)
    const allFields   = (config?.fields || []).filter(f => f.type !== 'datetime');
    const chartFields = allFields.filter(f => f.chart !== false);
    const icon        = config?.icon  || 'fas fa-cube';
    const title       = config?.label || moduleKey.toUpperCase();

    if (chartFields.length === 0) return null;

    const card = document.createElement('div');
    card.className = 'trend-card';
    card.id        = `trend-card-${moduleKey}`;

    const valPairs = chartFields.slice(0, 2).map((f, i) =>
        `<div class="trend-val-pair"><span class="trend-val" id="tcv-${moduleKey}-${f.key}">—</span><span class="trend-unit"> ${f.unit || ''}</span></div>`
    ).join('');

    const legend = chartFields.map((f, i) => {
        const color = f.color || TREND_COLORS[i % TREND_COLORS.length];
        return `<span class="trend-legend-item"><span class="trend-legend-swatch" style="background:${color}"></span> ${f.label}${f.unit ? ' (' + f.unit + ')' : ''}</span>`;
    }).join('');

    card.innerHTML = `
        <div class="trend-card-header">
            <span class="trend-card-title"><i class="${icon}"></i> ${title}</span>
            <div class="trend-card-vals">${valPairs}</div>
        </div>
        <div class="trend-chart-area" id="tca-${moduleKey}"></div>
        <div class="trend-legend">${legend}</div>
    `;
    container.appendChild(card);

    const series = chartFields.map((f, i) => ({
        key:      f.key,
        color:    f.color || TREND_COLORS[i % TREND_COLORS.length],
        valId:    `tcv-${moduleKey}-${f.key}`,
        decimals: f.decimals ?? 2,
    }));

    const chart = new TrendChart(`tca-${moduleKey}`, series);
    moduleTrendCharts[moduleKey] = chart;
    return chart;
}

// ── Dynamic instrument trend charts (in the Instruments section) ─

const dynInstrTrendCharts = {};

function getOrCreateDynInstrTrendChart(key, config) {
    // If cached but DOM removed (config edited) → discard and rebuild
    if (dynInstrTrendCharts[key] && !document.getElementById(`trend-dyn-card-${key}`)) {
        delete dynInstrTrendCharts[key];
    }
    if (dynInstrTrendCharts[key]) return dynInstrTrendCharts[key];

    const container = document.getElementById('trends-dyn-instrument-cards');
    if (!container) return null;

    // Only fields with chart !== false (and not datetime)
    const allFields   = (config?.fields || []).filter(f => f.type !== 'datetime');
    const chartFields = allFields.filter(f => f.chart !== false);
    const icon        = config?.icon  || 'fas fa-gauge';
    const title       = config?.label || key.replace(/_/g, ' ').toUpperCase();

    if (chartFields.length === 0) return null;

    const card = document.createElement('div');
    card.className = 'trend-card';
    card.id        = `trend-dyn-card-${key}`;

    const valPairs = chartFields.slice(0, 2).map(f =>
        `<div class="trend-val-pair"><span class="trend-val" id="tcv-dyn-${key}-${f.key}">—</span><span class="trend-unit"> ${f.unit || ''}</span></div>`
    ).join('');

    const legend = chartFields.map((f, i) => {
        const color = f.color || TREND_COLORS[i % TREND_COLORS.length];
        return `<span class="trend-legend-item"><span class="trend-legend-swatch" style="background:${color}"></span> ${f.label}${f.unit ? ' (' + f.unit + ')' : ''}</span>`;
    }).join('');

    card.innerHTML = `
        <div class="trend-card-header">
            <span class="trend-card-title"><i class="${icon}"></i> ${title}</span>
            <div class="trend-card-vals">${valPairs}</div>
        </div>
        <div class="trend-chart-area" id="tca-dyn-${key}"></div>
        <div class="trend-legend">${legend}</div>
    `;
    container.appendChild(card);

    const series = chartFields.map((f, i) => ({
        key:      f.key,
        color:    f.color || TREND_COLORS[i % TREND_COLORS.length],
        valId:    `tcv-dyn-${key}-${f.key}`,
        decimals: f.decimals ?? 3,
    }));

    const chart = new TrendChart(`tca-dyn-${key}`, series);
    dynInstrTrendCharts[key] = chart;
    return chart;
}

function renderAllTrends() {
    for (const c of Object.values(dynInstrTrendCharts)) c.render();
    for (const c of Object.values(moduleTrendCharts))   c.render();
}

// ══════════════════════════════════════════════════════════════════
// TEST LOG
// ══════════════════════════════════════════════════════════════════

const MAX_LOG  = 500;
const testLog  = [];
let logFilter  = 'all';

function addToTestLog(result) {
    testLog.unshift({
        time:    new Date().toLocaleTimeString('en-GB', { hour12: false }),
        task_id: result.task_id    || '—',
        agent:   result.agent_id  || '—',
        cycle:   result.cycle_number ?? '?',
        total:   result.total_cycles  ?? '?',
        result:  result.result        || '—',
        modules: Object.keys(result.details || {}).filter(k => !['load','power_supply','dmm'].includes(k)),
    });
    if (testLog.length > MAX_LOG) testLog.pop();

    if (document.getElementById('view-testlog')?.style.display !== 'none') {
        renderTestLog();
    } else {
        // Just update the count badge
        _updateLogCount();
    }
}

function renderTestLog() {
    const body = document.getElementById('testlogBody');
    if (!body) return;

    const filtered = logFilter === 'all' ? testLog : testLog.filter(r => r.result === logFilter);

    body.innerHTML = filtered.map(r => {
        const isPassed = r.result === 'pass';
        const chips    = r.modules.map(m => `<span class="tl-chip">${m}</span>`).join('');
        return `
        <div class="tl-row ${isPassed ? '' : 'fail-row'}">
            <span class="tl-time">${r.time}</span>
            <span class="tl-task">${r.task_id}</span>
            <span class="tl-agent">${r.agent}</span>
            <span class="tl-cycle">${r.cycle}/${r.total}</span>
            <span class="tl-result"><span class="badge ${isPassed ? 'ok' : 'fault'}">${isPassed ? 'PASS' : 'FAIL'}</span></span>
            <span class="tl-modules">${chips || '<span class="na">—</span>'}</span>
        </div>`;
    }).join('');

    _updateLogCount(filtered.length);
}

function _updateLogCount(shown) {
    const el = document.getElementById('testlogCount');
    if (el) el.textContent = shown != null
        ? `${shown} of ${testLog.length} entries`
        : `${testLog.length} entries`;
}

function initTestLog() {
    // Filter buttons
    document.querySelectorAll('.tl-filter-btn[data-filter]').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tl-filter-btn[data-filter]').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            logFilter = btn.dataset.filter;
            renderTestLog();
        });
    });
    // Clear
    document.getElementById('testlogClear')?.addEventListener('click', () => {
        testLog.length = 0;
        renderTestLog();
    });
}

// ══════════════════════════════════════════════════════════════════
// TAB SWITCHING
// ══════════════════════════════════════════════════════════════════

function initTabs() {
    const tabs = [
        { tabId: 'tab-live',    viewId: 'view-live',    onShow: null },
        { tabId: 'tab-trends',  viewId: 'view-trends',  onShow: renderAllTrends },
        { tabId: 'tab-testlog', viewId: 'view-testlog', onShow: renderTestLog },
        { tabId: 'tab-config',  viewId: 'view-config',  onShow: renderConfigLists },
    ];

    tabs.forEach(({ tabId, viewId, onShow }) => {
        document.getElementById(tabId)?.addEventListener('click', () => {
            tabs.forEach(t => {
                document.getElementById(t.tabId)?.classList.remove('active');
                const view = document.getElementById(t.viewId);
                if (view) view.style.display = 'none';
            });
            document.getElementById(tabId)?.classList.add('active');
            const target = document.getElementById(viewId);
            if (target) target.style.display = ''; // CSS takes over (grid / flex)
            if (onShow) onShow();
        });
    });
}

// ══════════════════════════════════════════════════════════════════
// DOM HELPERS
// ══════════════════════════════════════════════════════════════════

function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value ?? '—';
}

function setBadge(id, cls, text) {
    const el = document.getElementById(id);
    if (!el) return;
    el.className   = `badge ${cls}`;
    el.textContent = text;
}

// ══════════════════════════════════════════════════════════════════
// CLOCK
// ══════════════════════════════════════════════════════════════════

function startClock() {
    const tick = () => {
        const el = document.getElementById('topbarClock');
        if (el) el.textContent = new Date().toLocaleTimeString('en-GB', { hour12: false });
    };
    tick();
    setInterval(tick, 1000);
}

// ══════════════════════════════════════════════════════════════════
// BROKER STATUS PILL
// ══════════════════════════════════════════════════════════════════

function onBrokerStatus(data) {
    const pill        = document.getElementById('brokerStatusPill');
    const led         = document.getElementById('brokerLed');
    const txt         = document.getElementById('brokerStatusText');
    const alarmItem   = document.getElementById('alarmBroker');
    const alarmTxt    = document.getElementById('alarmBrokerText');

    if (data.status === 'ok') {
        if (pill)      pill.className      = 'status-pill ok';
        if (led)       led.className       = 'led ok pulse';
        if (txt)       txt.textContent     = 'BROKER OK';
        if (alarmItem) alarmItem.className = 'alarm-item ok';
        if (alarmTxt)  alarmTxt.textContent = `Broker connected · ${data.url || 'amqp://localhost'}`;
    } else if (data.status === 'connecting' || data.status === 'reconnecting') {
        if (pill)      pill.className      = 'status-pill dim';
        if (led)       led.className       = 'led dim pulse';
        if (txt)       txt.textContent     = data.status === 'reconnecting' ? 'RECONNECTING...' : 'CONNECTING...';
        if (alarmItem) alarmItem.className = 'alarm-item dim';
        if (alarmTxt)  alarmTxt.textContent = data.status === 'reconnecting' ? 'Broker reconnecting...' : 'Broker connecting...';
    } else {
        if (pill)      pill.className      = 'status-pill fault';
        if (led)       led.className       = 'led fault';
        if (txt)       txt.textContent     = 'BROKER FAULT';
        if (alarmItem) alarmItem.className = 'alarm-item fault';
        if (alarmTxt)  alarmTxt.textContent = `Broker error · ${data.message || 'connection failed'}`;
    }
}

// ══════════════════════════════════════════════════════════════════
// AGENT STATUS PILL
// ══════════════════════════════════════════════════════════════════

function onStatus(status) {
    const ledEl  = document.getElementById('agentLed');
    const pillEl = document.getElementById('agentStatusPill');
    const s      = (status.status || 'n/a').toLowerCase();

    setText('statusAgentId', status.agent_id || 'n/a');
    setText('status',        s.toUpperCase());

    let ledClass = 'led dim', pillClass = 'status-pill dim';
    if      (s === 'running' || s === 'busy')              { ledClass = 'led ok pulse'; pillClass = 'status-pill ok'; }
    else if (s === 'ready'   || s === 'idle')              { ledClass = 'led ok';       pillClass = 'status-pill ok'; }
    else if (s === 'error'   || s === 'fault' || s === 'aborted') { ledClass = 'led fault';   pillClass = 'status-pill fault'; }

    if (ledEl)  ledEl.className  = ledClass;
    if (pillEl) pillEl.className = pillClass;
}

// ══════════════════════════════════════════════════════════════════
// INSTRUMENTS — independent channel
// ══════════════════════════════════════════════════════════════════

function onInstruments(data) {
    const dynCfg = getDynInstruments();
    for (const [key, payload] of Object.entries(data)) {
        if (!isDynamic(key) || typeof payload !== 'object' || payload === null) continue;
        const config = dynCfg[key] ?? null;
        if (!config) continue;   // not in config — ignore (covers deleted instruments)

        upsertDynamicFaceplate(key, payload, config);

        const primaryKey = config.primaryKey
            ?? Object.keys(payload).find(k => !k.endsWith('_at'));
        if (primaryKey && payload[primaryKey] !== undefined) {
            getDynSparkline(key).push(payload[primaryKey]);
        }

        const chart = getOrCreateDynInstrTrendChart(key, config);
        if (chart) chart.push(payload);
    }
}

// ══════════════════════════════════════════════════════════════════
// TASK QUEUE (sidebar)
// ══════════════════════════════════════════════════════════════════

const TQ_MAX = 20;
let _lastCompletedTask = null;

function updateTaskQueue(result) {
    const taskId = result.task_id      || '—';
    const cycle  = result.cycle_number ?? '—';
    const total  = result.total_cycles  ?? null;

    setText('tqCurrentId',   taskId);
    setText('tqCurrentMeta', total != null ? `Cycle ${cycle} of ${total}` : `Cycle ${cycle}`);

    const tqBadge = document.getElementById('tqCurrentBadge');
    const tqWrap  = document.getElementById('tqProgressWrap');
    if (tqBadge) tqBadge.style.display = 'inline-flex';
    if (tqWrap)  tqWrap.style.display  = 'block';

    const tqFill = document.getElementById('tqProgressFill');
    if (tqFill && total && typeof cycle === 'number') {
        tqFill.style.width = `${Math.min(100, (cycle / total) * 100).toFixed(1)}%`;
    }

    // Task complete → push to history
    if (total && typeof cycle === 'number' && cycle >= total && taskId !== _lastCompletedTask) {
        _lastCompletedTask = taskId;
        _addTaskHistoryEntry(result);
    }
}

function _addTaskHistoryEntry(result) {
    const histEl = document.getElementById('tqHistory');
    if (!histEl) return;
    const isPassed = result.result === 'pass';
    const row = document.createElement('div');
    row.className = 'tq-hist-row';
    row.innerHTML = `
        <div class="tq-hist-left">
            <span class="tq-hist-id">${result.task_id || 'n/a'}</span>
            <span class="tq-hist-meta">${result.total_cycles ?? '?'} cycles &middot; ${new Date().toLocaleTimeString('en-GB', { hour12: false })}</span>
        </div>
        <div class="badge ${isPassed ? 'ok' : 'fault'}">${isPassed ? 'PASS' : 'FAIL'}</div>
    `;
    histEl.insertBefore(row, histEl.firstChild);
    while (histEl.children.length > TQ_MAX) histEl.removeChild(histEl.lastChild);
}

// ══════════════════════════════════════════════════════════════════
// ACTIVE TEST CARD (right panel)
// ══════════════════════════════════════════════════════════════════

function updateActiveTest(result) {
    const res = result.result || '—';
    setText('taskId',          result.task_id    || '—');
    setText('agentId',         result.agent_id   || '—');
    setText('statusTimestamp', result.timestamp  ? formatDate(result.timestamp) : '—');
    setText('activeScenario',  result.task_id    || '—');
    setText('cycleNumber',     String(result.cycle_number ?? '—'));
    setText('cycleDenom',      result.total_cycles != null ? `/ ${result.total_cycles}` : '');

    const resultEl = document.getElementById('result');
    if (resultEl) {
        resultEl.textContent = res.charAt(0).toUpperCase() + res.slice(1);
        resultEl.className   = res === 'pass' ? 'pass' : 'fail';
    }

    const fill = document.getElementById('cycleFill');
    if (fill && result.total_cycles && typeof result.cycle_number === 'number') {
        fill.style.width = `${Math.min(100, (result.cycle_number / result.total_cycles) * 100).toFixed(1)}%`;
    }

    const badge = document.getElementById('activeTestBadge');
    if (badge) badge.style.display = 'inline-flex';
}

// ══════════════════════════════════════════════════════════════════
// RESULT HISTORY (right panel, per-cycle)
// ══════════════════════════════════════════════════════════════════

const MAX_RH = 30;

function addToResultHistory(result) {
    const listEl = document.getElementById('resultHistory');
    if (!listEl) return;
    const isPassed = result.result === 'pass';
    const cycle    = result.cycle_number ?? '?';
    const total    = result.total_cycles  ?? '?';
    const entry    = document.createElement('div');
    entry.className = 'result-entry';
    entry.innerHTML = `
        <div class="result-icon ${isPassed ? 'pass' : 'fail'}">
            <i class="fas ${isPassed ? 'fa-check' : 'fa-times'}"></i>
        </div>
        <div class="result-body">
            <div class="result-title">${result.task_id || 'n/a'}</div>
            <div class="result-sub">cycle ${cycle}/${total} &middot; ${result.result || 'n/a'}</div>
        </div>
        <div class="result-time">${new Date().toLocaleTimeString('en-GB', { hour12: false })}</div>
    `;
    listEl.insertBefore(entry, listEl.firstChild);
    while (listEl.children.length > MAX_RH) listEl.removeChild(listEl.lastChild);
}

// ══════════════════════════════════════════════════════════════════
// MODULE HEALTH SIDEBAR BADGES
// ══════════════════════════════════════════════════════════════════

function updateModuleHealthBadge(key, hasFault) {
    setBadge(`mh-badge-${key}`, hasFault ? 'fault' : 'ok', hasFault ? 'FAULT' : 'OK');
}

// ══════════════════════════════════════════════════════════════════
// AUTH STATE
// ══════════════════════════════════════════════════════════════════

const authState = { authenticated: false, operator: null, readerPresent: false };

function onAuth(data) {
    const pill        = document.getElementById('operatorPill');
    const nameEl      = document.getElementById('operatorName');
    const banner      = document.getElementById('authBanner');
    const bannerTxt   = document.getElementById('authBannerText');

    if (data.type === 'reader_attached') {
        authState.readerPresent = true;
        if (pill) pill.classList.remove('no-reader');
        if (!authState.authenticated) {
            if (banner) banner.classList.add('visible');
            if (bannerTxt) bannerTxt.textContent = 'Tap badge to authenticate';
        }

    } else if (data.type === 'reader_detached') {
        authState.readerPresent = false;
        if (pill) pill.classList.add('no-reader');
        if (banner) banner.classList.remove('visible');
        _setAuth(false, null);

    } else if (data.type === 'authenticated') {
        _setAuth(true, data.operator);
        if (pill) { pill.className = 'operator-pill authed'; }
        if (nameEl) nameEl.textContent = data.operator?.name ?? 'Authenticated';
        if (banner) banner.classList.remove('visible');

    } else if (data.type === 'deauthenticated') {
        _setAuth(false, null);
        if (pill) { pill.className = 'operator-pill'; }
        if (nameEl) nameEl.textContent = 'Not authenticated';
        if (authState.readerPresent) {
            if (banner) banner.classList.add('visible');
            if (bannerTxt) bannerTxt.textContent = 'Tap badge to authenticate';
        }

    } else if (data.type === 'nfc_error') {
        if (bannerTxt) bannerTxt.textContent = `Auth error: ${data.message}`;
        if (banner) banner.classList.add('visible');
        setTimeout(() => { if (banner) banner.classList.remove('visible'); }, 4000);
    }
}

function _setAuth(authenticated, operator) {
    authState.authenticated = authenticated;
    authState.operator = operator;
    _applyWriteLocks();
}

function _applyWriteLocks() {
    // Write-protected elements: config add/edit buttons, reset button.
    // More controls can be added here as the system grows.
    const writeSelectors = ['#cfgAddInstrBtn', '#cfgAddModBtn', '#cfgResetBtn'];
    for (const sel of writeSelectors) {
        const el = document.querySelector(sel);
        if (!el) continue;
        if (authState.authenticated) {
            el.classList.remove('write-locked');
        } else {
            el.classList.add('write-locked');
        }
    }
}

// ══════════════════════════════════════════════════════════════════
// MEASUREMENT DISPATCHER
// ══════════════════════════════════════════════════════════════════

function onMeasurement(result) {
    updateActiveTest(result);
    updateTaskQueue(result);
    addToResultHistory(result);
    addToTestLog(result);

    const details  = result.details || {};
    const modCfg   = getModules();
    const instrKeys = new Set(Object.keys(getDynInstruments()));
    for (const [key, data] of Object.entries(details)) {
        // Instruments come via the instruments channel — skip them here
        if (instrKeys.has(key)) continue;

        const cfg = modCfg[key] ?? null;
        if (!cfg) continue;   // not in config — ignore (covers deleted modules)

        updateModuleCard(key, data, cfg);
        updateModuleHealthBadge(key, false);

        // Module trend chart
        const chart = getOrCreateModuleTrendChart(key, cfg);
        if (chart) chart.push(data);
    }
}

// ══════════════════════════════════════════════════════════════════
// BOOT
// ══════════════════════════════════════════════════════════════════

startClock();
initTabs();
initTestLog();
initConfigTab();

api.onBrokerStatus(onBrokerStatus);
api.onStatus(onStatus);
api.onInstruments(onInstruments);
api.onMeasurement(onMeasurement);
if (api.onAuth) api.onAuth(onAuth);

// Apply initial write locks (no reader = not authenticated)
_applyWriteLocks();
