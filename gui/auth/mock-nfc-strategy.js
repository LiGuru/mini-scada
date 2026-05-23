/**
 * MockNFCStrategy — development-only NFC simulator.
 *
 * Behaviour:
 *   - Immediately emits 'reader_attached' so the UI shows the pill.
 *   - F9 (or Ctrl+Shift+T)  →  first press authenticates, second removes card.
 *   - Does NOT require nfc-pcsc or a physical reader.
 *
 * Activated when MOCK_NFC=1 (or NODE_ENV=development + no real reader found).
 */
const { globalShortcut } = require('electron');
const { AuthStrategy } = require('./auth-strategy');

const MOCK_UID      = process.env.MOCK_NFC_UID || 'DEADBEEF';
const READER_NAME   = 'Mock NFC Reader (dev)';

class MockNFCStrategy extends AuthStrategy {
    constructor(options = {}) {
        super(options);
        this._cardPresent = false;
        this._apiBase     = (options.operatorsApiBase || '').replace(/\/$/, '');
        this._timeoutMs   = options.httpTimeoutMs ?? 4000;
    }

    start() {
        // Reader always "attached" in mock mode
        setTimeout(() => {
            this.emit('reader_attached', { name: READER_NAME });
        }, 200);

        // F9 toggles card in/out
        globalShortcut.register('F9', () => this._toggle());
    }

    stop() {
        globalShortcut.unregister('F9');
    }

    async _toggle() {
        if (this._cardPresent) {
            this._cardPresent = false;
            this.emit('deauthenticated', {});
        } else {
            this._cardPresent = true;
            try {
                const operator = await this._lookup(MOCK_UID);
                this.emit('authenticated', { operator });
            } catch (err) {
                this.emit('error', { message: err.message });
                this._cardPresent = false;
            }
        }
    }

    _lookup(uid) {
        const https = require('https');
        const http  = require('http');
        return new Promise((resolve, reject) => {
            const url = `${this._apiBase}/operators/nfc/${encodeURIComponent(uid)}`;
            const mod = url.startsWith('https') ? https : http;
            const req = mod.get(url, { timeout: this._timeoutMs }, (res) => {
                let body = '';
                res.on('data', (c) => { body += c; });
                res.on('end', () => {
                    if (res.statusCode === 200) {
                        try { resolve(JSON.parse(body)); }
                        catch { reject(new Error('Invalid JSON from operators API')); }
                    } else if (res.statusCode === 404) {
                        reject(new Error(`Badge ${uid} not registered`));
                    } else {
                        reject(new Error(`Operators API returned ${res.statusCode}`));
                    }
                });
            });
            req.on('error', (e) => reject(new Error(`Operators API unreachable: ${e.message}`)));
            req.on('timeout', () => { req.destroy(); reject(new Error('Operators API timeout')); });
        });
    }
}

module.exports = { MockNFCStrategy };
