"""
Keysight Oscilloscope driver.
Real: DSOX1204G, MSO6054A, InfiniiVision — SCPI via VISA.
Mock: simulates waveform parameters without hardware.
"""

from __future__ import annotations
import random
from datetime import datetime, UTC
from typing import Any

from ..base import InstrumentDriver


def _iso() -> str:
    return datetime.now(UTC).isoformat() + 'Z'


class Oscilloscope(InstrumentDriver):
    MODEL = "Keysight Oscilloscope"
    CAPABILITIES = {
        "set_timebase":  {"seconds_div": "float — time/div in seconds"},
        "set_scale":     {"channel": "int — 1..4", "volts_div": "float — V/div"},
        "set_trigger":   {"channel": "int — trigger channel", "level": "float — trigger level V"},
        "single":        {},
        "run":           {},
        "stop":          {},
        "measure":       {"param": "str — FREQ|PERIOD|AMP|VRMS|DUTYCYCLE", "channel": "int"},
        "query":         {"scpi": "str — raw SCPI query"},
    }

    def connect(self) -> None:
        import pyvisa
        rm = pyvisa.ResourceManager()
        self._inst = rm.open_resource(self._resource)
        self._inst.timeout = 15_000

    def disconnect(self) -> None:
        if getattr(self, '_inst', None):
            self._inst.close()
            self._inst = None

    def read(self) -> dict[str, Any]:
        try:
            freq   = float(self._inst.query("MEAS:FREQ? CHAN1"))
            ampl   = float(self._inst.query("MEAS:VAMP? CHAN1"))
            vrms   = float(self._inst.query("MEAS:VRMS? DISP,AC,CHAN1"))
            period = float(self._inst.query("MEAS:PER? CHAN1"))
            return {
                "frequency":   round(freq, 2),
                "amplitude":   round(ampl, 4),
                "vrms":        round(vrms, 4),
                "period_us":   round(period * 1e6, 4),
                "measured_at": _iso(),
            }
        except Exception as e:
            return {"error": str(e), "measured_at": _iso()}

    def execute(self, cmd: str, args: dict[str, Any]) -> str:
        match cmd:
            case "set_timebase":
                self._inst.write(f"TIM:SCAL {args['seconds_div']}")
                return f"Time/div → {args['seconds_div']} s"
            case "set_scale":
                ch = int(args["channel"])
                self._inst.write(f"CHAN{ch}:SCAL {args['volts_div']}")
                return f"CH{ch} scale → {args['volts_div']} V/div"
            case "set_trigger":
                ch  = int(args["channel"])
                lvl = float(args["level"])
                self._inst.write(f"TRIG:SOUR CHAN{ch}; TRIG:LEV {lvl}")
                return f"Trigger: CH{ch} @ {lvl} V"
            case "single":
                self._inst.write("SING")
                return "Single acquisition triggered"
            case "run":
                self._inst.write("RUN")
                return "Running"
            case "stop":
                self._inst.write("STOP")
                return "Stopped"
            case "measure":
                param = str(args["param"]).upper()
                ch    = int(args.get("channel", 1))
                val   = self._inst.query(f"MEAS:{param}? CHAN{ch}").strip()
                return f"CH{ch} {param} = {val}"
            case "query":
                return self._inst.query(str(args["scpi"])).strip()
            case _:
                raise ValueError(f"Unknown command: {cmd!r}")


class MockOscilloscope(Oscilloscope):

    def connect(self) -> None:
        self._freq = 5_000.0
        self._ampl = 2.0

    def disconnect(self) -> None:
        pass

    def read(self) -> dict[str, Any]:
        return {
            "frequency":   round(self._freq * (1 + random.uniform(-0.005, 0.005)), 2),
            "amplitude":   round(self._ampl * (1 + random.uniform(-0.01, 0.01)), 4),
            "vrms":        round(self._ampl / 2.828 + random.uniform(-0.005, 0.005), 4),
            "period_us":   round(1e6 / self._freq, 4),
            "measured_at": _iso(),
        }

    def execute(self, cmd: str, args: dict[str, Any]) -> str:
        match cmd:
            case "set_timebase":
                return f"[Mock] Time/div → {args['seconds_div']} s"
            case "set_scale":
                return f"[Mock] CH{args['channel']} scale → {args['volts_div']} V/div"
            case "set_trigger":
                return f"[Mock] Trigger CH{args['channel']} @ {args['level']} V"
            case "single":
                return "[Mock] Single acquisition"
            case "run":
                return "[Mock] Running"
            case "stop":
                return "[Mock] Stopped"
            case "measure":
                ch = args.get("channel", 1)
                return f"[Mock] CH{ch} {args['param']} = {random.uniform(1.0, 100.0):.3f}"
            case "query":
                return f"[Mock] {args.get('scpi','?')} → OK"
            case _:
                raise ValueError(f"Unknown command: {cmd!r}")
