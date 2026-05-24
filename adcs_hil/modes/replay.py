"""adcs_hil/modes/replay.py — CSV telemetry replay mode.

Reads a CSV recorded from a real CubeADCS Gen2 run and re-plays it at
configurable speed against the HIL runner. Columns are mapped in the
d2s2 scenario file under replay.columns.

Default column map (applied when scenario map is empty):
    q0      → adcs_q0     (or q0 if not found)
    q1      → adcs_q1
    q2      → adcs_q2
    q3      → adcs_q3
    wx_rps  → adcs_wx     (rad/s)
    wy_rps  → adcs_wy
    wz_rps  → adcs_wz
    rw0_rpm → rw0_rpm
    rw1_rpm → rw1_rpm
    rw2_rpm → rw2_rpm
    rw3_rpm → rw3_rpm
    mag_x_ut → mag_x_ut
    mag_y_ut → mag_y_ut
    mag_z_ut → mag_z_ut
"""

from __future__ import annotations
import csv
import time
from pathlib import Path
from typing import Any

from ..d2s2 import D2S2Scenario
from .base import SimMode
from .static import StaticMode

# ── Default column map (output_field → likely CSV column name) ─────────────────
_DEFAULTS: dict[str, list[str]] = {
    "q0":      ["q0", "adcs_q0", "quat_0"],
    "q1":      ["q1", "adcs_q1", "quat_1"],
    "q2":      ["q2", "adcs_q2", "quat_2"],
    "q3":      ["q3", "adcs_q3", "quat_3"],
    "wx_rps":  ["wx_rps", "adcs_wx", "omega_x", "gyrox"],
    "wy_rps":  ["wy_rps", "adcs_wy", "omega_y", "gyroy"],
    "wz_rps":  ["wz_rps", "adcs_wz", "omega_z", "gyroz"],
    "rw0_rpm": ["rw0_rpm", "rw0", "rw_speed_0"],
    "rw1_rpm": ["rw1_rpm", "rw1", "rw_speed_1"],
    "rw2_rpm": ["rw2_rpm", "rw2", "rw_speed_2"],
    "rw3_rpm": ["rw3_rpm", "rw3", "rw_speed_3"],
    "mag_x_ut": ["mag_x_ut", "mag_x", "b_x"],
    "mag_y_ut": ["mag_y_ut", "mag_y", "b_y"],
    "mag_z_ut": ["mag_z_ut", "mag_z", "b_z"],
}

_VALID_MODES = {"STANDBY", "DETUMBLING", "Y_WHEEL_MOMENTUM", "NADIR_POINTING",
                "SUN_TRACKING", "GROUND_TRACKING", "COMMISSIONING"}


class ReplayMode(SimMode):
    """Replays recorded CSV telemetry at configurable speed."""

    def __init__(self, scenario: D2S2Scenario) -> None:
        self._scenario = scenario
        rp = scenario.replay
        self._speed  = max(0.0, rp.speed)
        self._loop   = rp.loop

        csv_path = scenario.resolve_replay_file()
        self._rows: list[dict[str, float]] = []
        self._col_map: dict[str, str] = {}    # output_field → csv_column

        # Load CSV
        if csv_path.exists():
            self._load_csv(csv_path, rp)
        else:
            import warnings
            warnings.warn(f"Replay file not found: {csv_path} — falling back to static zeros")

        self._idx: float  = 0.0    # float index for fractional advancement
        self._state_machine = scenario.initial_state.state_machine_mode
        self._fallback = StaticMode(scenario) if not self._rows else None

    # ── SimMode interface ─────────────────────────────────────────────────────

    def tick(self, dt: float) -> dict[str, Any]:
        if self._fallback:
            return self._fallback.tick(dt)

        # Advance index by speed-scaled rows
        if self._speed > 0:
            # Estimate rows-per-second from data (use 5 Hz as default guess)
            rows_per_s = self._speed * 5.0
            self._idx += dt * rows_per_s
        else:
            # As-fast-as-possible: advance one row per tick
            self._idx += 1.0

        n = len(self._rows)
        if self._loop:
            row = self._rows[int(self._idx) % n]
        else:
            row = self._rows[min(int(self._idx), n - 1)]

        out = {
            "q0":      round(row.get("q0",      1.0), 6),
            "q1":      round(row.get("q1",      0.0), 6),
            "q2":      round(row.get("q2",      0.0), 6),
            "q3":      round(row.get("q3",      0.0), 6),
            "wx_rps":  round(row.get("wx_rps",  0.0), 6),
            "wy_rps":  round(row.get("wy_rps",  0.0), 6),
            "wz_rps":  round(row.get("wz_rps",  0.0), 6),
            "rw0_rpm": round(row.get("rw0_rpm", 0.0), 2),
            "rw1_rpm": round(row.get("rw1_rpm", 0.0), 2),
            "rw2_rpm": round(row.get("rw2_rpm", 0.0), 2),
            "rw3_rpm": round(row.get("rw3_rpm", 0.0), 2),
            "mag_x_ut": round(row.get("mag_x_ut", 23.0), 3),
            "mag_y_ut": round(row.get("mag_y_ut",-15.0), 3),
            "mag_z_ut": round(row.get("mag_z_ut", 42.0), 3),
            "state_machine": self._state_machine,
            "sim_mode": "replay",
            "replay_row": int(self._idx) % len(self._rows),
            "replay_total": len(self._rows),
        }
        return out

    def apply_command(self, cmd: str, args: dict[str, Any]) -> str:
        if cmd == "set_mode":
            mode = str(args.get("mode", "")).upper()
            if mode not in _VALID_MODES:
                raise ValueError(f"Unknown ADCS mode {mode!r}.")
            self._state_machine = mode
            return f"State machine → {mode}"

        if cmd == "set_speed":
            self._speed = max(0.0, float(args.get("speed", 1.0)))
            return f"Replay speed → {self._speed}×"

        if cmd == "seek":
            row = int(args.get("row", 0))
            self._idx = float(max(0, min(row, len(self._rows) - 1)))
            return f"Seeked to row {int(self._idx)}"

        if cmd == "reset":
            self._idx = 0.0
            self._state_machine = "STANDBY"
            return "Replay reset to row 0"

        if cmd in ("set_attitude", "set_rw_speed"):
            return f"Command {cmd!r} ignored in replay mode"

        raise ValueError(f"Unknown command: {cmd!r}")

    # ── CSV loading ───────────────────────────────────────────────────────────

    def _load_csv(self, path: Path, rp) -> None:
        with open(path, newline="") as fh:
            reader = csv.DictReader(fh)
            headers = reader.fieldnames or []

            # Build column map: scenario overrides first, then auto-detect defaults
            user_map: dict[str, str] = dict(rp.columns)
            self._col_map = {}
            for field, candidates in _DEFAULTS.items():
                if field in user_map:
                    col = user_map[field]
                    if col in headers:
                        self._col_map[field] = col
                else:
                    for c in candidates:
                        if c in headers:
                            self._col_map[field] = c
                            break

            for raw_row in reader:
                row: dict[str, float] = {}
                for field, col in self._col_map.items():
                    try:
                        row[field] = float(raw_row[col])
                    except (ValueError, KeyError):
                        row[field] = 0.0
                self._rows.append(row)
