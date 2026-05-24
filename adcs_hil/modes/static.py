"""adcs_hil/modes/static.py — Static (frozen state) simulation mode.

Useful for health checks and protocol testing when you only need the
ADCS to respond correctly without any dynamics.
"""

from __future__ import annotations
from typing import Any

from ..d2s2 import D2S2Scenario
from .base import SimMode

_VALID_MODES = {"STANDBY", "DETUMBLING", "Y_WHEEL_MOMENTUM", "NADIR_POINTING",
                "SUN_TRACKING", "GROUND_TRACKING", "COMMISSIONING"}


class StaticMode(SimMode):
    """Returns the same fixed state on every tick."""

    def __init__(self, scenario: D2S2Scenario) -> None:
        st = scenario.static
        ist = scenario.initial_state

        self._state_machine = ist.state_machine_mode or st.state_machine_mode
        q = st.quaternion
        self._q0, self._q1, self._q2, self._q3 = q[0], q[1], q[2], q[3]
        w = st.angular_rate_rps
        self._wx, self._wy, self._wz = w[0], w[1], w[2]
        rw = ist.rw_speeds_rpm or st.rw_speeds_rpm
        self._rw = list(rw[:4]) + [0.0] * (4 - len(rw))
        b = st.mag_ut
        self._bx, self._by, self._bz = b[0], b[1], b[2]

    # ── SimMode interface ─────────────────────────────────────────────────────

    def tick(self, dt: float) -> dict[str, Any]:
        return {
            "q0": round(self._q0, 6),
            "q1": round(self._q1, 6),
            "q2": round(self._q2, 6),
            "q3": round(self._q3, 6),
            "wx_rps": round(self._wx, 6),
            "wy_rps": round(self._wy, 6),
            "wz_rps": round(self._wz, 6),
            "rw0_rpm": round(self._rw[0], 2),
            "rw1_rpm": round(self._rw[1], 2),
            "rw2_rpm": round(self._rw[2], 2),
            "rw3_rpm": round(self._rw[3], 2),
            "mag_x_ut": round(self._bx, 3),
            "mag_y_ut": round(self._by, 3),
            "mag_z_ut": round(self._bz, 3),
            "state_machine": self._state_machine,
            "sim_mode": "static",
        }

    def apply_command(self, cmd: str, args: dict[str, Any]) -> str:
        if cmd == "set_mode":
            mode = str(args.get("mode", "")).upper()
            if mode not in _VALID_MODES:
                raise ValueError(f"Unknown ADCS mode {mode!r}. Valid: {sorted(_VALID_MODES)}")
            self._state_machine = mode
            return f"State machine → {mode}"

        if cmd == "set_attitude":
            q = args.get("quaternion", [])
            if len(q) == 4:
                self._q0, self._q1, self._q2, self._q3 = (float(x) for x in q)
                return "Attitude set"
            raise ValueError("quaternion must be a 4-element list [q0, q1, q2, q3]")

        if cmd == "set_rw_speed":
            idx  = int(args.get("wheel", 0))
            rpm  = float(args.get("speed_rpm", 0.0))
            if idx < 0 or idx > 3:
                raise ValueError("wheel must be 0–3")
            self._rw[idx] = rpm
            return f"RW{idx} → {rpm:.1f} RPM"

        if cmd == "reset":
            self._state_machine = "STANDBY"
            self._wx = self._wy = self._wz = 0.0
            self._rw = [0.0, 0.0, 0.0, 0.0]
            return "ADCS reset to STANDBY"

        raise ValueError(f"Unknown command: {cmd!r}")
