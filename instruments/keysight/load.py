"""
Keysight / Agilent Electronic Load driver.
Real: N3300A, 6060A, 63101A — SCPI via VISA.
Mock: simulates load behavior without hardware.
"""

from __future__ import annotations
import random
from datetime import datetime, UTC
from typing import Any

from ..base import InstrumentDriver


def _iso() -> str:
    return datetime.now(UTC).isoformat() + 'Z'


class ElectronicLoad(InstrumentDriver):
    MODEL = "Keysight Electronic Load"
    CAPABILITIES = {
        "set_mode":      {"mode": "str — CC | CV | CR | CP"},
        "set_current":   {"current": "float — current setpoint in A (CC mode)"},
        "set_voltage":   {"voltage": "float — voltage setpoint in V (CV mode)"},
        "set_resistance":{"resistance": "float — resistance setpoint in Ω (CR mode)"},
        "set_power":     {"power": "float — power setpoint in W (CP mode)"},
        "input_on":      {},
        "input_off":     {},
        "query":         {"scpi": "str — raw SCPI query"},
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
            voltage  = float(self._inst.query("MEAS:VOLT?"))
            current  = float(self._inst.query("MEAS:CURR?"))
            power    = float(self._inst.query("MEAS:POW?"))
            inp_on   = self._inst.query("INP?").strip() == '1'
            mode     = self._inst.query("MODE?").strip()
            return {
                "voltage":     round(voltage, 4),
                "current":     round(current, 5),
                "power":       round(power, 4),
                "input_on":    inp_on,
                "mode":        mode,
                "measured_at": _iso(),
            }
        except Exception as e:
            return {"error": str(e), "measured_at": _iso()}

    def execute(self, cmd: str, args: dict[str, Any]) -> str:
        match cmd:
            case "set_mode":
                m = str(args["mode"]).upper()
                self._inst.write(f"MODE {m}")
                return f"Mode → {m}"
            case "set_current":
                i = float(args["current"])
                self._inst.write(f"CURR {i}")
                return f"Current setpoint → {i} A"
            case "set_voltage":
                v = float(args["voltage"])
                self._inst.write(f"VOLT {v}")
                return f"Voltage setpoint → {v} V"
            case "set_resistance":
                r = float(args["resistance"])
                self._inst.write(f"RES {r}")
                return f"Resistance → {r} Ω"
            case "set_power":
                w = float(args["power"])
                self._inst.write(f"POW {w}")
                return f"Power → {w} W"
            case "input_on":
                self._inst.write("INP ON")
                return "Input ON"
            case "input_off":
                self._inst.write("INP OFF")
                return "Input OFF"
            case "query":
                return self._inst.query(str(args["scpi"])).strip()
            case _:
                raise ValueError(f"Unknown command: {cmd!r}")


class MockElectronicLoad(ElectronicLoad):

    def connect(self) -> None:
        self._state = {"mode": "CC", "current": 0.5, "voltage": 4.0, "input_on": True}

    def disconnect(self) -> None:
        pass

    def read(self) -> dict[str, Any]:
        i = self._state["current"] * (1 + random.uniform(-0.01, 0.01)) if self._state["input_on"] else 0.0
        v = self._state["voltage"] * (1 + random.uniform(-0.005, 0.005))
        return {
            "voltage":     round(v, 4),
            "current":     round(i, 5),
            "power":       round(v * i, 4),
            "input_on":    self._state["input_on"],
            "mode":        self._state["mode"],
            "measured_at": _iso(),
        }

    def execute(self, cmd: str, args: dict[str, Any]) -> str:
        match cmd:
            case "set_mode":
                self._state["mode"] = str(args["mode"]).upper()
                return f"[Mock] Mode → {self._state['mode']}"
            case "set_current":
                self._state["current"] = float(args["current"])
                return f"[Mock] Current → {self._state['current']} A"
            case "set_voltage":
                self._state["voltage"] = float(args["voltage"])
                return f"[Mock] Voltage → {self._state['voltage']} V"
            case "set_resistance":
                return f"[Mock] Resistance → {args['resistance']} Ω"
            case "set_power":
                return f"[Mock] Power → {args['power']} W"
            case "input_on":
                self._state["input_on"] = True
                return "[Mock] Input ON"
            case "input_off":
                self._state["input_on"] = False
                return "[Mock] Input OFF"
            case "query":
                return f"[Mock] {args.get('scpi','?')} → OK"
            case _:
                raise ValueError(f"Unknown command: {cmd!r}")
