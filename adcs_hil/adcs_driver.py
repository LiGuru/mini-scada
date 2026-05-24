"""
adcs_hil/adcs_driver.py — CubeADCS Gen2 simulation driver.

Implements InstrumentDriver so it plugs directly into instr_runner.py's
driver registry.  The driver delegates all state to a SimMode instance,
which can be swapped at runtime via the `load_scenario` command.
"""

from __future__ import annotations
import time
from pathlib import Path
from typing import Any

from instruments.base import InstrumentDriver
from .d2s2 import D2S2Scenario, load as load_scenario
from .modes import SimMode, make_mode


class CubeAdcsGen2Driver(InstrumentDriver):
    """Hardware-In-the-Loop driver for CubeADCS Gen2."""

    MODEL = "CubeADCS Gen2 HIL"

    CAPABILITIES: dict[str, dict[str, str]] = {
        # State machine
        "set_mode": {
            "mode": "str — STANDBY|DETUMBLING|Y_WHEEL_MOMENTUM|NADIR_POINTING|SUN_TRACKING|GROUND_TRACKING",
        },
        # Reaction wheels
        "set_rw_speed": {
            "wheel":     "int — 0–3",
            "speed_rpm": "float — RPM (negative = reverse)",
        },
        # Replay-specific
        "set_speed": {
            "speed": "float — replay speed multiplier (1.0 = realtime, 0 = max)",
        },
        "seek": {
            "row": "int — jump to CSV row (replay mode only)",
        },
        # Manual override
        "set_attitude": {
            "quaternion": "list[float] — [q0, q1, q2, q3] scalar-first",
        },
        # Scenario hot-swap
        "load_scenario": {
            "path": "str — path to .d2s2 file",
        },
        # Hard reset
        "reset": {},
    }

    def __init__(self, resource: str) -> None:
        """
        Args:
            resource: path to a .d2s2 scenario file, or 'MOCK' for a default static scenario.
        """
        super().__init__(resource)
        self._scenario: D2S2Scenario | None = None
        self._sim: SimMode | None = None
        self._last_tick = 0.0

    # ── InstrumentDriver lifecycle ────────────────────────────────────────────

    def connect(self) -> None:
        if self._resource.upper() == "MOCK":
            self._load_default_scenario()
        else:
            scenario = load_scenario(self._resource)
            self._scenario = scenario
            self._sim = make_mode(scenario)
        self._last_tick = time.monotonic()

    def disconnect(self) -> None:
        self._sim = None
        self._scenario = None

    # ── Data ─────────────────────────────────────────────────────────────────

    def read(self) -> dict[str, Any]:
        if self._sim is None:
            return {"error": "not connected"}
        try:
            now = time.monotonic()
            dt  = now - self._last_tick
            self._last_tick = now
            data = self._sim.tick(dt)
            data["measured_at"] = time.time()
            return data
        except Exception as e:
            return {"error": str(e)}

    # ── Commands ──────────────────────────────────────────────────────────────

    def execute(self, cmd: str, args: dict[str, Any]) -> str:
        if self._sim is None:
            raise RuntimeError("Driver not connected")

        if cmd == "load_scenario":
            path = str(args.get("path", ""))
            if not path:
                raise ValueError("path argument is required")
            scenario = load_scenario(path)
            self._scenario = scenario
            self._sim = make_mode(scenario)
            self._last_tick = time.monotonic()
            return f"Loaded scenario '{scenario.meta.name}' (mode={scenario.mode})"

        return self._sim.apply_command(cmd, args)

    # ── Private ───────────────────────────────────────────────────────────────

    def _load_default_scenario(self) -> None:
        """Create a minimal detumbling scenario without a file."""
        from .d2s2 import (D2S2Scenario, D2S2Meta, D2S2Static,
                           D2S2InitialState, D2S2Telemetry, D2S2Replay, D2S2Physics)
        from pathlib import Path

        s = D2S2Scenario()
        s.meta  = D2S2Meta(name="mock_detumbling",
                           description="Default HIL mock — detumbling with slow tumble")
        s.mode  = "physics"
        s.physics.initial_omega_rps  = [0.05, -0.03, 0.08]
        s.physics.initial_quaternion = [0.9239, 0.3827, 0.0, 0.0]  # 45° roll
        s.initial_state.state_machine_mode = "DETUMBLING"
        s.telemetry.interval_ms = 200
        self._scenario = s
        self._sim = make_mode(s)


class MockCubeAdcsGen2Driver(CubeAdcsGen2Driver):
    """Alias — mock flag is handled by resource='MOCK' in base class."""
    pass
