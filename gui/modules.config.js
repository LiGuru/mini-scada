/**
 * modules.config.js
 *
 * Central registry for all known data sources.
 *
 * INSTRUMENT_CONFIG — test bench instruments (shown as circles at top).
 * MODULE_CONFIG     — satellite subsystem modules (shown as cards in the middle panel).
 *
 * To add a new module:
 *   1. Add an entry under MODULE_CONFIG with the same key that the executor
 *      uses inside `details` (e.g. details.eps → key "eps").
 *   2. Define `fields` — each entry maps a data key to a display label + unit.
 *   3. Restart the executor so it starts emitting the new key in results.
 *
 * Field descriptor shape:
 *   { key: string, label: string, unit?: string, decimals?: number, type?: 'datetime' }
 */

/**
 * Dynamic bench instruments published on the `instruments` exchange.
 * Any key not in {load, power_supply, dmm} is matched here.
 * Add a new entry to make a new faceplate + trend chart appear automatically.
 */
export const DYNAMIC_INSTRUMENT_CONFIG = {
    // ── Fixed instruments (always present, not deletable from UI) ──
    load: {
        label:      'Load',
        icon:       'fas fa-plug',
        primaryKey: 'current',
        fixed:      true,
        fields: [
            { key: 'current',     label: 'Current',     unit: 'A', decimals: 4 },
            { key: 'voltage',     label: 'Voltage',     unit: 'V', decimals: 4 },
            { key: 'measured_at', label: 'Measured At', type: 'datetime' },
        ],
    },
    power_supply: {
        label:      'Power Supply',
        icon:       'fas fa-bolt',
        primaryKey: 'current',
        fixed:      true,
        fields: [
            { key: 'current',     label: 'Current',     unit: 'A', decimals: 4 },
            { key: 'voltage',     label: 'Voltage',     unit: 'V', decimals: 4 },
            { key: 'measured_at', label: 'Measured At', type: 'datetime' },
        ],
    },
    dmm: {
        label:      'DMM',
        icon:       'fas fa-tachometer-alt',
        primaryKey: 'voltage',
        fixed:      true,
        fields: [
            { key: 'current',     label: 'Current',     unit: 'A', decimals: 4 },
            { key: 'voltage',     label: 'Voltage',     unit: 'V', decimals: 4 },
            { key: 'resistance',  label: 'Resistance',  unit: 'Ω', decimals: 4 },
            { key: 'measured_at', label: 'Measured At', type: 'datetime' },
        ],
    },
    // ── Dynamic instruments (user-managed) ────────────────────────
    rf_generator: {
        label:      'RF Gen',
        icon:       'fas fa-broadcast-tower',
        primaryKey: 'frequency',
        fields: [
            { key: 'frequency', label: 'Frequency', unit: 'MHz', decimals: 3 },
            { key: 'power',     label: 'Power',     unit: 'dBm', decimals: 1 },
        ],
    },
    oscilloscope: {
        label:      'Oscilloscope',
        icon:       'fas fa-wave-square',
        primaryKey: 'amplitude',
        fields: [
            { key: 'frequency', label: 'Frequency', unit: 'Hz', decimals: 1 },
            { key: 'amplitude', label: 'Amplitude', unit: 'V',  decimals: 3 },
            { key: 'phase',     label: 'Phase',     unit: '°',  decimals: 1 },
        ],
    },
    spectrum_analyzer: {
        label:      'Spectrum',
        icon:       'fas fa-chart-bar',
        primaryKey: 'peak_power',
        fields: [
            { key: 'center_freq', label: 'Center',    unit: 'MHz', decimals: 1 },
            { key: 'peak_power',  label: 'Peak',      unit: 'dBm', decimals: 1 },
            { key: 'bandwidth',   label: 'Bandwidth', unit: 'MHz', decimals: 2 },
        ],
    },
    temp_controller: {
        label:      'Temp Ctrl',
        icon:       'fas fa-thermometer-half',
        primaryKey: 'actual',
        fields: [
            { key: 'setpoint',   label: 'Setpoint', unit: '°C', decimals: 1 },
            { key: 'actual',     label: 'Actual',   unit: '°C', decimals: 1 },
            { key: 'duty_cycle', label: 'Heater',   unit: '%',  decimals: 0 },
        ],
    },
    daq: {
        label:      'DAQ',
        icon:       'fas fa-sliders-h',
        primaryKey: 'ch1',
        fields: [
            { key: 'ch1', label: 'CH1', unit: 'V', decimals: 4 },
            { key: 'ch2', label: 'CH2', unit: 'V', decimals: 4 },
            { key: 'ch3', label: 'CH3', unit: 'V', decimals: 4 },
            { key: 'ch4', label: 'CH4', unit: 'V', decimals: 4 },
        ],
    },
};

export const INSTRUMENT_CONFIG = {
    load: {
        label: 'Load',
        icon: 'fas fa-plug',
        fields: [
            { key: 'current',     label: 'Current',     unit: 'A',  decimals: 4 },
            { key: 'voltage',     label: 'Voltage',     unit: 'V',  decimals: 4 },
            { key: 'measured_at', label: 'Measured At', type: 'datetime' },
        ],
    },
    power_supply: {
        label: 'Power Supply',
        icon: 'fas fa-bolt',
        fields: [
            { key: 'current',     label: 'Current',     unit: 'A',  decimals: 4 },
            { key: 'voltage',     label: 'Voltage',     unit: 'V',  decimals: 4 },
            { key: 'measured_at', label: 'Measured At', type: 'datetime' },
        ],
    },
    dmm: {
        label: 'DMM',
        icon: 'fas fa-tachometer-alt',
        fields: [
            { key: 'current',     label: 'Current',     unit: 'A',  decimals: 4 },
            { key: 'voltage',     label: 'Voltage',     unit: 'V',  decimals: 4 },
            { key: 'resistance',  label: 'Resistance',  unit: 'Ω',  decimals: 4 },
            { key: 'measured_at', label: 'Measured At', type: 'datetime' },
        ],
    },
};

export const MODULE_CONFIG = {
    eps: {
        label: 'EPS Module',
        icon: 'fas fa-battery-full',
        fields: [
            { key: 'battery_voltage', label: 'Battery Voltage', unit: 'V',   decimals: 3 },
            { key: 'battery_current', label: 'Battery Current', unit: 'A',   decimals: 3 },
            { key: 'soc',             label: 'State of Charge', unit: '%',   decimals: 1 },
            { key: 'temperature',     label: 'Temperature',     unit: '°C',  decimals: 1 },
            { key: 'measured_at',     label: 'Measured At',     type: 'datetime' },
        ],
    },
    uhf: {
        label: 'UHF Module',
        icon: 'fas fa-satellite',
        fields: [
            { key: 'signal_strength', label: 'Signal Strength', unit: 'dBm', decimals: 1 },
            { key: 'bitrate',         label: 'Bitrate',         unit: 'bps', decimals: 0 },
            { key: 'rssi',            label: 'RSSI',            unit: 'dBm', decimals: 1 },
            { key: 'measured_at',     label: 'Measured At',     type: 'datetime' },
        ],
    },
    obc: {
        label: 'OBC Module',
        icon: 'fas fa-microchip',
        fields: [
            { key: 'cpu_load',     label: 'CPU Load',     unit: '%', decimals: 1 },
            { key: 'memory_used',  label: 'Memory Used',  unit: '%', decimals: 1 },
            { key: 'uptime',       label: 'Uptime',       unit: 's', decimals: 0 },
            { key: 'measured_at',  label: 'Measured At',  type: 'datetime' },
        ],
    },
    adcs: {
        label: 'ADCS Module',
        icon: 'fas fa-compass',
        fields: [
            { key: 'attitude',          label: 'Attitude',          unit: '°',     decimals: 2 },
            { key: 'angular_velocity',  label: 'Angular Velocity',  unit: 'rad/s', decimals: 3 },
            { key: 'measured_at',       label: 'Measured At',       type: 'datetime' },
        ],
    },
    sdr: {
        label: 'SDR Module',
        icon: 'fas fa-broadcast-tower',
        fields: [
            { key: 'spectrum',    label: 'Spectrum',   unit: 'MHz', decimals: 1 },
            { key: 'bandwidth',   label: 'Bandwidth',  unit: 'kHz', decimals: 0 },
            { key: 'measured_at', label: 'Measured At', type: 'datetime' },
        ],
    },
    sband: {
        label: 'S-BAND Transceiver',
        icon: 'fas fa-broadcast-tower',
        fields: [
            { key: 'tx_power',    label: 'Tx Power',   unit: 'dBm', decimals: 1 },
            { key: 'rx_power',    label: 'Rx Power',   unit: 'dBm', decimals: 1 },
            { key: 'measured_at', label: 'Measured At', type: 'datetime' },
        ],
    },
    xband: {
        label: 'X-BAND Transmitter',
        icon: 'fas fa-signal',
        fields: [
            { key: 'throughput',  label: 'Throughput', unit: 'Mbps', decimals: 2 },
            { key: 'temperature', label: 'Temperature', unit: '°C',  decimals: 1 },
            { key: 'measured_at', label: 'Measured At', type: 'datetime' },
        ],
    },
};
