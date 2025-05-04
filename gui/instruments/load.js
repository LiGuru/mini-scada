import {formatDate, roundValue} from "../utils/helpers.js";

export function updateLoad(details) {
    const current = document.getElementById('LoadCurrent');
    const voltage = document.getElementById('LoadVoltage');
    const measuredAt = document.getElementById('LoadMeasuredAt');
    if (current) current.innerText = roundValue(details.current, 4) || 'n/a';
    if (voltage) voltage.innerText = roundValue(details.voltage, 4) || 'n/a';
    if (measuredAt) measuredAt.innerText = formatDate(details.measured_at) || 'n/a';
}
