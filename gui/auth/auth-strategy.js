/**
 * Base class for authentication strategies (NFC, Bluetooth, КЕП).
 * Subclasses emit:
 *   'authenticated'    { operator: OperatorRecord }
 *   'deauthenticated'  {}
 *   'reader_attached'  { name: string }
 *   'reader_detached'  { name: string }
 *   'error'            { message: string }
 */
const { EventEmitter } = require('events');

class AuthStrategy extends EventEmitter {
    constructor(options = {}) {
        super();
        this.options = options;
    }

    /** Start listening (connect to reader, BLE scan, etc.) */
    start() {
        throw new Error(`${this.constructor.name}.start() not implemented`);
    }

    /** Clean up all resources. */
    stop() {
        throw new Error(`${this.constructor.name}.stop() not implemented`);
    }
}

module.exports = { AuthStrategy };
