import { formatDate, roundValue } from '../utils/helpers.js';

export function updatePowerSupply(details) {
    const current = document.getElementById('PSCurrent');
    const voltage = document.getElementById('PSVoltage');
    const measuredAt = document.getElementById('PSMeasuredAt');
    if (current) current.innerText = roundValue(details.current, 4) || 'n/a';
    if (voltage) voltage.innerText = roundValue(details.voltage, 4) || 'n/a';
    if (measuredAt) measuredAt.innerText = formatDate(details.measured_at) || 'n/a';
}
