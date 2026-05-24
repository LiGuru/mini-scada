"""
Keysight RF Signal Generator driver.
Real: E4438C, N5182B, E8267D — SCPI via VISA.
Mock: simulates state changes without hardware.
"""

from __future__ import annotations
import random
from datetime import datetime, UTC
from typing import Any

from ..base import InstrumentDriver


def _iso() -> str:
    return datetime.now(UTC).isoformat() + 'Z'


class RfGenerator(InstrumentDriver):
    MODEL = "Keysight RF Generator"
    CAPABILITIES = {
        "set_freq":  {"freq_hz": "float — carrier frequency in Hz (e.g. 2.45e9)"},
        "set_power": {"dbm": "float — output power in dBm (e.g. -10.0)"},
        "rf_on":     {},
        "rf_off":    {},
        "query":     {"scpi": "str — raw SCPI query string"},
    }

    def connect(self) -> None:
        import pyvisa
        rm = pyvisa.ResourceManager()
        self._inst = rm.open_resource(self._resource)
        self._inst.timeout = 5000
        self._inst.write("*RST")

    def disconnect(self) -> None:
        if getattr(self, '_inst', None):
            self._inst.close()
            self._inst = None

    def read(self) -> dict[str, Any]:
        try:
            freq  = float(self._inst.query("FREQ?"))
            power = float(self._inst.query("POW?"))
            rf_on = self._inst.query("OUTP?").strip() == '1'
            return {
                "frequency":   round(freq / 1e6, 6),   # MHz
                "power":       round(power, 2),          # dBm
                "rf_on":       rf_on,
                "measured_at": _iso(),
            }
        except Exception as e:
            return {"error": str(e), "measured_at": _iso()}

    def execute(self, cmd: str, args: dict[str, Any]) -> str:
        match cmd:
            case "set_freq":
                hz = float(args["freq_hz"])
                self._inst.write(f"FREQ {hz}")
                return f"Frequency set to {hz / 1e6:.3f} MHz"
            case "set_power":
                dbm = float(args["dbm"])
                self._inst.write(f"POW {dbm}")
                return f"Power set to {dbm} dBm"
            case "rf_on":
                self._inst.write("OUTP ON")
                return "RF output ON"
            case "rf_off":
                self._inst.write("OUTP OFF")
                return "RF output OFF"
            case "query":
                return self._inst.query(str(args["scpi"])).strip()
            case _:
                raise ValueError(f"Unknown command: {cmd!r}")


class MockRfGenerator(RfGenerator):
    """Drop-in mock — no VISA required."""

    def connect(self) -> None:
        self._state = {"freq_hz": 2_450_000_000.0, "dbm": 0.0, "rf_on": True}

    def disconnect(self) -> None:
        pass

    def read(self) -> dict[str, Any]:
        noise = random.uniform(-0.005, 0.005)
        return {
            "frequency":   round(self._state["freq_hz"] / 1e6 + noise, 4),
            "power":       round(self._state["dbm"] + random.uniform(-0.02, 0.02), 2),
            "rf_on":       self._state["rf_on"],
            "measured_at": _iso(),
        }

    def execute(self, cmd: str, args: dict[str, Any]) -> str:
        match cmd:
            case "set_freq":
                self._state["freq_hz"] = float(args["freq_hz"])
                return f"[Mock] Frequency → {self._state['freq_hz'] / 1e6:.3f} MHz"
            case "set_power":
                self._state["dbm"] = float(args["dbm"])
                return f"[Mock] Power → {self._state['dbm']} dBm"
            case "rf_on":
                self._state["rf_on"] = True
                return "[Mock] RF output ON"
            case "rf_off":
                self._state["rf_on"] = False
                return "[Mock] RF output OFF"
            case "query":
                return f"[Mock] {args.get('scpi', '?')} → OK"
            case _:
                raise ValueError(f"Unknown command: {cmd!r}")
