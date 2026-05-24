"""
Keysight Digital Multimeter driver.
Real: 34461A, 34465A, 34470A — SCPI via VISA.
Mock: simulates readings without hardware.
"""

from __future__ import annotations
import random
from datetime import datetime, UTC
from typing import Any

from ..base import InstrumentDriver


def _iso() -> str:
    return datetime.now(UTC).isoformat() + 'Z'


class DMM(InstrumentDriver):
    MODEL = "Keysight DMM"
    CAPABILITIES = {
        "measure_voltage": {"mode": "str — 'DC' or 'AC'"},
        "measure_current": {"mode": "str — 'DC' or 'AC'"},
        "measure_resistance": {},
        "auto_range":      {"on": "bool"},
        "query":           {"scpi": "str — raw SCPI query"},
    }

    def connect(self) -> None:
        import pyvisa
        rm = pyvisa.ResourceManager()
        self._inst = rm.open_resource(self._resource)
        self._inst.timeout = 10_000
        self._inst.write("*RST")

    def disconnect(self) -> None:
        if getattr(self, '_inst', None):
            self._inst.close()
            self._inst = None

    def read(self) -> dict[str, Any]:
        try:
            voltage    = float(self._inst.query("MEAS:VOLT:DC?"))
            current    = float(self._inst.query("MEAS:CURR:DC?"))
            resistance = float(self._inst.query("MEAS:RES?"))
            return {
                "voltage":     round(voltage,    6),
                "current":     round(current,    7),
                "resistance":  round(resistance, 4),
                "measured_at": _iso(),
            }
        except Exception as e:
            return {"error": str(e), "measured_at": _iso()}

    def execute(self, cmd: str, args: dict[str, Any]) -> str:
        match cmd:
            case "measure_voltage":
                mode = str(args.get("mode", "DC")).upper()
                v = float(self._inst.query(f"MEAS:VOLT:{mode}?"))
                return f"{mode} voltage: {v:.6f} V"
            case "measure_current":
                mode = str(args.get("mode", "DC")).upper()
                i = float(self._inst.query(f"MEAS:CURR:{mode}?"))
                return f"{mode} current: {i:.7f} A"
            case "measure_resistance":
                r = float(self._inst.query("MEAS:RES?"))
                return f"Resistance: {r:.4f} Ω"
            case "auto_range":
                state = "ON" if args.get("on", True) else "OFF"
                self._inst.write(f"VOLT:RANG:AUTO {state}")
                return f"Auto-range {state}"
            case "query":
                return self._inst.query(str(args["scpi"])).strip()
            case _:
                raise ValueError(f"Unknown command: {cmd!r}")


class MockDMM(DMM):

    def connect(self) -> None:
        self._base = {"voltage": 3.75, "current": 0.12, "resistance": 2.1}

    def disconnect(self) -> None:
        pass

    def read(self) -> dict[str, Any]:
        return {
            "voltage":     round(self._base["voltage"]    + random.uniform(-0.01, 0.01), 6),
            "current":     round(self._base["current"]    + random.uniform(-0.005, 0.005), 7),
            "resistance":  round(self._base["resistance"] + random.uniform(-0.05, 0.05), 4),
            "measured_at": _iso(),
        }

    def execute(self, cmd: str, args: dict[str, Any]) -> str:
        match cmd:
            case "measure_voltage":
                mode = args.get("mode", "DC")
                return f"[Mock] {mode} voltage: {self._base['voltage'] + random.uniform(-0.01,0.01):.6f} V"
            case "measure_current":
                mode = args.get("mode", "DC")
                return f"[Mock] {mode} current: {self._base['current'] + random.uniform(-0.001,0.001):.7f} A"
            case "measure_resistance":
                return f"[Mock] Resistance: {self._base['resistance'] + random.uniform(-0.05,0.05):.4f} Ω"
            case "auto_range":
                return f"[Mock] Auto-range {'ON' if args.get('on', True) else 'OFF'}"
            case "query":
                return f"[Mock] {args.get('scpi','?')} → OK"
            case _:
                raise ValueError(f"Unknown command: {cmd!r}")
