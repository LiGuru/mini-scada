"""
Keysight Power Supply driver.
Real: E3645A, E3649A, E36312A — SCPI via VISA.
Mock: simulates state changes without hardware.
"""

from __future__ import annotations
import random
from datetime import datetime, UTC
from typing import Any

from ..base import InstrumentDriver


def _iso() -> str:
    return datetime.now(UTC).isoformat() + 'Z'


class PowerSupply(InstrumentDriver):
    MODEL = "Keysight Power Supply"
    CAPABILITIES = {
        "set_voltage":  {"voltage": "float — output voltage in V"},
        "set_current":  {"current": "float — current limit in A"},
        "output_on":    {},
        "output_off":   {},
        "query":        {"scpi": "str — raw SCPI query"},
    }

    def connect(self) -> None:
        import pyvisa
        rm = pyvisa.ResourceManager()
        self._inst = rm.open_resource(self._resource)
        self._inst.timeout = 5000

    def disconnect(self) -> None:
        if getattr(self, '_inst', None):
            self._inst.close()
            self._inst = None

    def read(self) -> dict[str, Any]:
        try:
            voltage = float(self._inst.query("MEAS:VOLT?"))
            current = float(self._inst.query("MEAS:CURR?"))
            out_on  = self._inst.query("OUTP?").strip() == '1'
            setv    = float(self._inst.query("VOLT?"))
            setc    = float(self._inst.query("CURR?"))
            return {
                "voltage":     round(voltage, 4),
                "current":     round(current, 5),
                "power":       round(voltage * current, 4),
                "output_on":   out_on,
                "set_voltage": round(setv, 3),
                "set_current": round(setc, 4),
                "measured_at": _iso(),
            }
        except Exception as e:
            return {"error": str(e), "measured_at": _iso()}

    def execute(self, cmd: str, args: dict[str, Any]) -> str:
        match cmd:
            case "set_voltage":
                v = float(args["voltage"])
                self._inst.write(f"VOLT {v}")
                return f"Voltage setpoint → {v} V"
            case "set_current":
                i = float(args["current"])
                self._inst.write(f"CURR {i}")
                return f"Current limit → {i} A"
            case "output_on":
                self._inst.write("OUTP ON")
                return "Output ON"
            case "output_off":
                self._inst.write("OUTP OFF")
                return "Output OFF"
            case "query":
                return self._inst.query(str(args["scpi"])).strip()
            case _:
                raise ValueError(f"Unknown command: {cmd!r}")


class MockPowerSupply(PowerSupply):

    def connect(self) -> None:
        self._state = {"voltage": 4.0, "current_lim": 1.0, "output_on": True}

    def disconnect(self) -> None:
        pass

    def read(self) -> dict[str, Any]:
        v = self._state["voltage"] * (1 + random.uniform(-0.002, 0.002))
        i = random.uniform(0.45, 0.65) if self._state["output_on"] else 0.0
        return {
            "voltage":     round(v, 4),
            "current":     round(i, 5),
            "power":       round(v * i, 4),
            "output_on":   self._state["output_on"],
            "set_voltage": self._state["voltage"],
            "set_current": self._state["current_lim"],
            "measured_at": _iso(),
        }

    def execute(self, cmd: str, args: dict[str, Any]) -> str:
        match cmd:
            case "set_voltage":
                self._state["voltage"] = float(args["voltage"])
                return f"[Mock] Voltage → {self._state['voltage']} V"
            case "set_current":
                self._state["current_lim"] = float(args["current"])
                return f"[Mock] Current limit → {self._state['current_lim']} A"
            case "output_on":
                self._state["output_on"] = True
                return "[Mock] Output ON"
            case "output_off":
                self._state["output_on"] = False
                return "[Mock] Output OFF"
            case "query":
                return f"[Mock] {args.get('scpi', '?')} → OK"
            case _:
                raise ValueError(f"Unknown command: {cmd!r}")
