/**
 * NFC authentication strategy using nfc-pcsc (PC/SC reader — e.g. ACR122U).
 *
 * Flow:
 *   card tap → read UID → GET /operators/nfc/{uid} → emit 'authenticated'
 *   card removed          → emit 'deauthenticated'
 *   no reader present     → emits nothing, logs warning (non-fatal)
 *
 * Linux note: pcsclite must be installed before npm install + npm run rebuild.
 *   sudo apt-get install pcscd libpcsclite-dev && npm run rebuild
 */
const https = require('https');
const http  = require('http');
const { AuthStrategy } = require('./auth-strategy');

class NFCAuthStrategy extends AuthStrategy {
    /**
     * @param {object} options
     * @param {string} options.operatorsApiBase  e.g. "https://vlahovski.info/api/v1"
     * @param {number} [options.httpTimeoutMs]   default 4000
     */
    constructor(options = {}) {
        super(options);
        this._nfc        = null;
        this._apiBase    = (options.operatorsApiBase || '').replace(/\/$/, '');
        this._timeoutMs  = options.httpTimeoutMs ?? 4000;
        this._currentUid = null;
    }

    start() {
        // Lazy-load so a missing/uncompiled native addon doesn't crash the
        // whole process — it just reports a recoverable error instead.
        let NFC;
        try {
            NFC = require('nfc-pcsc').NFC;
        } catch (e) {
            const hint = process.platform === 'linux'
                ? '  Fix: sudo apt-get install pcscd libpcsclite-dev && npm run rebuild'
                : '  Fix: npm run rebuild';
            this.emit('error', {
                message: `NFC module failed to load: ${e.message}.${hint}`,
            });
            return;
        }

        try {
            this._nfc = new NFC();
        } catch (e) {
            this.emit('error', { message: `NFC init failed: ${e.message}` });
            return;
        }

        this._nfc.on('reader', (reader) => {
            this.emit('reader_attached', { name: reader.name });

            reader.on('card', async (card) => {
                const uid = this._uidFromCard(card);
                if (!uid) return;
                this._currentUid = uid;

                try {
                    const operator = await this._lookupOperator(uid);
                    this.emit('authenticated', { operator });
                } catch (err) {
                    this.emit('error', { message: err.message });
                }
            });

            reader.on('card.off', () => {
                this._currentUid = null;
                this.emit('deauthenticated', {});
            });

            reader.on('error', (err) => {
                this.emit('error', { message: `Reader ${reader.name}: ${err.message}` });
            });
        });

        this._nfc.on('error', (err) => {
            this.emit('error', { message: `NFC error: ${err.message}` });
        });
    }

    stop() {
        // nfc-pcsc does not expose a close method; set to null for GC.
        this._nfc = null;
    }

    // ── Helpers ──────────────────────────────────────────────

    _uidFromCard(card) {
        if (card.uid) return card.uid.toUpperCase();
        if (card.atr) return Buffer.from(card.atr).toString('hex').toUpperCase();
        return null;
    }

    _lookupOperator(uid) {
        return new Promise((resolve, reject) => {
            const url  = `${this._apiBase}/operators/nfc/${encodeURIComponent(uid)}`;
            const mod  = url.startsWith('https') ? https : http;
            const req  = mod.get(url, { timeout: this._timeoutMs }, (res) => {
                let body = '';
                res.on('data', (chunk) => { body += chunk; });
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

module.exports = { NFCAuthStrategy };
