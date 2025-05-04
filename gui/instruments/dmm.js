import {formatDate, roundValue} from "../utils/helpers.js";

export function updateDMM(details) {
    const current = document.getElementById('DMMCurrent');
    const voltage = document.getElementById('DMMVoltage');
    const resistance = document.getElementById('DMMResistance');
    const measuredAt = document.getElementById('DMMMeasuredAt');
    if (current) current.innerText = roundValue(details.current, 4) || 'n/a';
    if (voltage) voltage.innerText = roundValue(details.voltage, 4) || 'n/a';
    if (resistance) resistance.innerText = roundValue(details.resistance, 4) || 'n/a';
    if (measuredAt) measuredAt.innerText = formatDate(details.measured_at) || 'n/a';


}
