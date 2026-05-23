/**
 * preview-stub.js — browser preview only (not loaded in Electron).
 *
 * Instruments update at 300 ms independently.
 * Test measurements update at 1.8 s.
 */

window.electronAPI = {
    _brokerCbs:      [],
    _statusCbs:      [],
    _measurementCbs: [],
    _instrumentCbs:  [],

    onBrokerStatus(cb) { this._brokerCbs.push(cb); },
    onStatus(cb)       { this._statusCbs.push(cb); },
    onMeasurement(cb)  { this._measurementCbs.push(cb); },
    onInstruments(cb)  { this._instrumentCbs.push(cb); },

    _emitBroker(d)      { this._brokerCbs.forEach(cb => cb(d)); },
    _emitStatus(d)      { this._statusCbs.forEach(cb => cb(d)); },
    _emitMeasurement(d) { this._measurementCbs.forEach(cb => cb(d)); },
    _emitInstruments(d) { this._instrumentCbs.forEach(cb => cb(d)); },
};

// ── Helpers ──────────────────────────────────────────────────────

function rand(lo, hi) { return lo + Math.random() * (hi - lo); }
function pick(arr)    { return arr[Math.floor(Math.random() * arr.length)]; }
function iso()        { return new Date().toISOString(); }

// ── Instrument readings (independent, high-frequency) ────────────

function fakeInstruments() {
    return {
        agent_id:  'bench-01',
        timestamp: iso(),
        load: {
            current:     rand(0.10, 0.22),
            voltage:     rand(3.70, 4.10),
            measured_at: iso(),
        },
        power_supply: {
            current:     rand(0.45, 0.75),
            voltage:     rand(3.90, 4.20),
            measured_at: iso(),
        },
        dmm: {
            current:     rand(0.09, 0.18),
            voltage:     rand(3.65, 4.05),
            resistance:  rand(1.8, 2.6),
            measured_at: iso(),
        },
        rf_generator: {
            frequency:   rand(430.0, 470.0),
            power:       rand(-10.0, 10.0),
            measured_at: iso(),
        },
        oscilloscope: {
            frequency:   rand(1000.0, 9999.0),
            amplitude:   rand(0.5, 5.0),
            phase:       rand(-180.0, 180.0),
            measured_at: iso(),
        },
        spectrum_analyzer: {
            center_freq: rand(432.0, 438.0),
            peak_power:  rand(-60.0, -20.0),
            bandwidth:   rand(0.5, 4.0),
            measured_at: iso(),
        },
        temp_controller: {
            setpoint:   25.0,
            actual:     rand(22.5, 27.5),
            duty_cycle: rand(0.0, 100.0),
            measured_at: iso(),
        },
        daq: {
            ch1: rand(0.0,  3.3),
            ch2: rand(0.0,  5.0),
            ch3: rand(0.0, 12.0),
            ch4: rand(-5.0, 5.0),
            measured_at: iso(),
        },
    };
}

// ── Test measurements (module data only, no instruments) ──────────

const SCENARIOS = {
    'battery-cycle-check': (cycle) => ({
        task_id:      'battery-cycle-check',
        agent_id:     'bench-01',
        cycle_number: cycle,
        total_cycles: 5,
        result:       cycle === 4 ? 'fail' : 'pass',
        timestamp:    iso(),
        details: {
            eps: {
                battery_voltage: rand(3.6, 4.2),
                battery_current: rand(0.5, 2.0),
                soc:             rand(55, 98),
                temperature:     rand(20, 38),
                measured_at:     iso(),
            },
        },
    }),

    'uhf-signal-check': (cycle) => ({
        task_id:      'uhf-signal-check',
        agent_id:     'bench-01',
        cycle_number: cycle,
        total_cycles: 3,
        result:       'pass',
        timestamp:    iso(),
        details: {
            uhf: {
                signal_strength: rand(-75, -42),
                bitrate:         pick([1200, 2400, 4800, 9600]),
                rssi:            rand(-85, -48),
                measured_at:     iso(),
            },
        },
    }),

    'obc-health-check': (cycle) => ({
        task_id:      'obc-health-check',
        agent_id:     'bench-01',
        cycle_number: cycle,
        total_cycles: 4,
        result:       'pass',
        timestamp:    iso(),
        details: {
            obc: {
                cpu_load:    rand(12, 72),
                memory_used: rand(28, 85),
                uptime:      Math.floor(rand(0, 86400)),
                measured_at: iso(),
            },
        },
    }),
};

const SCENARIO_KEYS = Object.keys(SCENARIOS);
let scenarioIdx     = 0;
let cycleInScenario = 1;

function nextMeasurement() {
    const key    = SCENARIO_KEYS[scenarioIdx % SCENARIO_KEYS.length];
    const result = SCENARIOS[key](cycleInScenario);
    const total  = result.total_cycles;

    cycleInScenario++;
    if (cycleInScenario > total) {
        cycleInScenario = 1;
        scenarioIdx++;
    }
    return result;
}

// ── Boot ─────────────────────────────────────────────────────────

window.addEventListener('DOMContentLoaded', () => {

    // Simulate broker connected immediately in preview
    window.electronAPI._emitBroker({ status: 'ok', url: 'amqp://localhost (preview)' });

    window.electronAPI._emitStatus({ agent_id: 'bench-01', status: 'ready',   timestamp: iso() });

    setTimeout(() => {
        window.electronAPI._emitStatus({ agent_id: 'bench-01', status: 'running', timestamp: iso() });
    }, 800);

    // Instruments: independent 300 ms loop
    setInterval(() => {
        window.electronAPI._emitInstruments(fakeInstruments());
    }, 300);

    // Measurements: 1.8 s loop
    setInterval(() => {
        window.electronAPI._emitMeasurement(nextMeasurement());
    }, 1800);
});
