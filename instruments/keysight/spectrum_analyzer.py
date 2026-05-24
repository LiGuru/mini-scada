"""
Keysight Spectrum Analyzer driver.
Real: N9320B, E4402B, N9030B — SCPI via VISA.
Mock: simulates RF spectrum measurements.
"""

from __future__ import annotations
import random
from datetime import datetime, UTC
from typing import Any

from ..base import InstrumentDriver


def _iso() -> str:
    return datetime.now(UTC).isoformat() + 'Z'


class SpectrumAnalyzer(InstrumentDriver):
    MODEL = "Keysight Spectrum Analyzer"
    CAPABILITIES = {
        "set_center_freq": {"freq_hz": "float — center frequency in Hz"},
        "set_span":        {"span_hz": "float — span in Hz"},
        "set_rbw":         {"rbw_hz":  "float — resolution bandwidth in Hz"},
        "set_ref_level":   {"dbm": "float — reference level in dBm"},
        "peak_search":     {},
        "marker_to_peak":  {},
        "query":           {"scpi": "str — raw SCPI query"},
    }

    def connect(self) -> None:
        import pyvisa
        rm = pyvisa.ResourceManager()
        self._inst = rm.open_resource(self._resource)
        self._inst.timeout = 20_000

    def disconnect(self) -> None:
        if getattr(self, '_inst', None):
            self._inst.close()
            self._inst = None

    def read(self) -> dict[str, Any]:
        try:
            cf    = float(self._inst.query("FREQ:CENT?"))
            span  = float(self._inst.query("FREQ:SPAN?"))
            # Marker peak reading
            self._inst.write("CALC:MARK:MAX")
            peak_freq  = float(self._inst.query("CALC:MARK:X?"))
            peak_power = float(self._inst.query("CALC:MARK:Y?"))
            return {
                "center_freq":  round(cf / 1e6, 4),       # MHz
                "span_mhz":     round(span / 1e6, 3),
                "peak_freq_mhz": round(peak_freq / 1e6, 6),
                "peak_power":   round(peak_power, 2),
                "measured_at":  _iso(),
            }
        except Exception as e:
            return {"error": str(e), "measured_at": _iso()}

    def execute(self, cmd: str, args: dict[str, Any]) -> str:
        match cmd:
            case "set_center_freq":
                hz = float(args["freq_hz"])
                self._inst.write(f"FREQ:CENT {hz}")
                return f"Center → {hz / 1e6:.3f} MHz"
            case "set_span":
                hz = float(args["span_hz"])
                self._inst.write(f"FREQ:SPAN {hz}")
                return f"Span → {hz / 1e6:.3f} MHz"
            case "set_rbw":
                hz = float(args["rbw_hz"])
                self._inst.write(f"BAND {hz}")
                return f"RBW → {hz / 1e3:.1f} kHz"
            case "set_ref_level":
                dbm = float(args["dbm"])
                self._inst.write(f"DISP:WIND:TRAC:Y:RLEV {dbm}")
                return f"Ref level → {dbm} dBm"
            case "peak_search":
                self._inst.write("CALC:MARK:MAX")
                freq  = float(self._inst.query("CALC:MARK:X?"))
                power = float(self._inst.query("CALC:MARK:Y?"))
                return f"Peak: {freq / 1e6:.4f} MHz @ {power:.2f} dBm"
            case "marker_to_peak":
                self._inst.write("CALC:MARK:MAX")
                return "Marker moved to peak"
            case "query":
                return self._inst.query(str(args["scpi"])).strip()
            case _:
                raise ValueError(f"Unknown command: {cmd!r}")


class MockSpectrumAnalyzer(SpectrumAnalyzer):

    def connect(self) -> None:
        self._center_mhz = 435.0
        self._span_mhz   = 5.0

    def disconnect(self) -> None:
        pass

    def read(self) -> dict[str, Any]:
        peak_offset = random.uniform(-0.5, 0.5)
        return {
            "center_freq":   round(self._center_mhz + random.uniform(-0.001, 0.001), 4),
            "span_mhz":      self._span_mhz,
            "peak_freq_mhz": round(self._center_mhz + peak_offset, 6),
            "peak_power":    round(random.uniform(-55.0, -25.0), 2),
            "measured_at":   _iso(),
        }

    def execute(self, cmd: str, args: dict[str, Any]) -> str:
        match cmd:
            case "set_center_freq":
                self._center_mhz = float(args["freq_hz"]) / 1e6
                return f"[Mock] Center → {self._center_mhz:.3f} MHz"
            case "set_span":
                self._span_mhz = float(args["span_hz"]) / 1e6
                return f"[Mock] Span → {self._span_mhz:.3f} MHz"
            case "set_rbw":
                return f"[Mock] RBW → {float(args['rbw_hz']) / 1e3:.1f} kHz"
            case "set_ref_level":
                return f"[Mock] Ref level → {args['dbm']} dBm"
            case "peak_search" | "marker_to_peak":
                return f"[Mock] Peak: {self._center_mhz + random.uniform(-0.2,0.2):.4f} MHz @ {random.uniform(-50.0,-30.0):.2f} dBm"
            case "query":
                return f"[Mock] {args.get('scpi','?')} → OK"
            case _:
                raise ValueError(f"Unknown command: {cmd!r}")
