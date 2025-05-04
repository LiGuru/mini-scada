// utils/helpers.js

export function formatDate(isoString) {
    try {
        let cleanIso = isoString.replace(/\.\d{3,}/, (match) => match.substring(0, 4));
        cleanIso = cleanIso.replace('+00:00Z', 'Z');
        const date = new Date(cleanIso);
        if (isNaN(date.getTime())) return 'Invalid date';
        return date.toLocaleString();
    } catch (e) {
        return 'Invalid date';
    }
}
export function roundValue(value, decimals = 2) {
    if (typeof value !== 'number') {
        value = parseFloat(value);
    }
    if (isNaN(value)) return 'n/a';
    const factor = Math.pow(10, decimals);
    return Math.round(value * factor) / factor;
}
