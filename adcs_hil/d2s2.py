"""
adcs_hil/d2s2.py — d2s2 scenario file loader and schema validator.

d2s2 (Device-to-Simulator Scenario) is the ADCS HIL test scenario format.
A d2s2 file describes what the simulator should produce — either a static
fixed state, a replay of recorded CSV telemetry, or a live physics model.

File format: YAML  (.d2s2 or .yaml)

Minimal valid file
------------------
    meta:
        name: my_scenario
    mode: static
    static:
        state_machine_mode: STANDBY

Full reference
--------------
    meta:
        name: "detumbling"
        description: "Post-separation detumbling"
        adcs_model: cubeadcs_gen2

    mode: replay          # static | replay | physics

    replay:
        file: "scenarios/data/adcs_detumbling.csv"
        time_column: UnixTime      # CSV column to use as wall-clock timestamp
        columns:                   # map: output field → CSV column name
            q0:   adcs_q0
            q1:   adcs_q1
            q2:   adcs_q2
            q3:   adcs_q3
            wx_rps: adcs_wx
            wy_rps: adcs_wy
            wz_rps: adcs_wz
        speed: 1.0                 # 1.0 = realtime, >1 = faster, 0 = as fast as possible
        loop:  true

    physics:
        initial_quaternion: [1.0, 0.0, 0.0, 0.0]   # [q0, q1, q2, q3]  scalar-first
        initial_omega_rps:  [0.05, -0.03, 0.08]     # body angular velocity, rad/s
        initial_rw_rpm:     [0, 0, 0, 0]
        inertia_kg_m2:
            Ixx: 0.10
            Iyy: 0.20
            Izz: 0.15
        rw_axis_matrix:     [[1,0,0],[0,1,0],[0,0,1],[0.577,0.577,0.577]]
        b_field_body_ut:    [23.0, -15.0, 42.0]     # constant background mag field

    static:
        state_machine_mode: DETUMBLING
        quaternion:         [1.0, 0.0, 0.0, 0.0]
        angular_rate_rps:   [0.0, 0.0, 0.0]
        rw_speeds_rpm:      [0, 0, 0, 0]
        mag_ut:             [23.0, -15.0, 42.0]

    initial_state:
        state_machine_mode: DETUMBLING
        rw_speeds_rpm:      [0, 0, 0, 0]

    telemetry:
        interval_ms: 200
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

try:
    import yaml
except ImportError as e:
    raise ImportError("PyYAML is required: pip install pyyaml") from e


# ── Data classes ───────────────────────────────────────────────────────────────

@dataclass
class D2S2Meta:
    name:        str   = "unnamed"
    description: str   = ""
    adcs_model:  str   = "cubeadcs_gen2"


@dataclass
class D2S2Replay:
    file:         str               = ""
    time_column:  str               = "UnixTime"
    columns:      dict[str, str]    = field(default_factory=dict)
    speed:        float             = 1.0
    loop:         bool              = True


@dataclass
class D2S2Inertia:
    Ixx: float = 0.10
    Iyy: float = 0.20
    Izz: float = 0.15


@dataclass
class D2S2Physics:
    initial_quaternion: list[float]       = field(default_factory=lambda: [1.0, 0.0, 0.0, 0.0])
    initial_omega_rps:  list[float]       = field(default_factory=lambda: [0.0, 0.0, 0.0])
    initial_rw_rpm:     list[float]       = field(default_factory=lambda: [0.0, 0.0, 0.0, 0.0])
    inertia_kg_m2:      D2S2Inertia       = field(default_factory=D2S2Inertia)
    rw_axis_matrix:     list[list[float]] = field(
        default_factory=lambda: [[1,0,0],[0,1,0],[0,0,1],[0.577,0.577,0.577]]
    )
    b_field_body_ut:    list[float]       = field(default_factory=lambda: [23.0, -15.0, 42.0])


@dataclass
class D2S2Static:
    state_machine_mode: str         = "STANDBY"
    quaternion:         list[float] = field(default_factory=lambda: [1.0, 0.0, 0.0, 0.0])
    angular_rate_rps:   list[float] = field(default_factory=lambda: [0.0, 0.0, 0.0])
    rw_speeds_rpm:      list[float] = field(default_factory=lambda: [0.0, 0.0, 0.0, 0.0])
    mag_ut:             list[float] = field(default_factory=lambda: [23.0, -15.0, 42.0])


@dataclass
class D2S2InitialState:
    state_machine_mode: str         = "STANDBY"
    rw_speeds_rpm:      list[float] = field(default_factory=lambda: [0.0, 0.0, 0.0, 0.0])


@dataclass
class D2S2Telemetry:
    interval_ms: int = 200


@dataclass
class D2S2Scenario:
    meta:          D2S2Meta         = field(default_factory=D2S2Meta)
    mode:          str              = "static"   # static | replay | physics
    replay:        D2S2Replay       = field(default_factory=D2S2Replay)
    physics:       D2S2Physics      = field(default_factory=D2S2Physics)
    static:        D2S2Static       = field(default_factory=D2S2Static)
    initial_state: D2S2InitialState = field(default_factory=D2S2InitialState)
    telemetry:     D2S2Telemetry    = field(default_factory=D2S2Telemetry)

    # Path to the file (for resolving relative paths inside replay.file)
    _source_dir: Path = field(default_factory=Path, repr=False)

    def resolve_replay_file(self) -> Path:
        """Resolve replay.file relative to the scenario file's directory."""
        p = Path(self.replay.file)
        if p.is_absolute():
            return p
        return self._source_dir / p


# ── Parser ─────────────────────────────────────────────────────────────────────

def load(path: str | Path) -> D2S2Scenario:
    """Load and parse a d2s2 scenario file.  Raises on schema errors."""
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(f"d2s2 scenario not found: {path}")

    with open(path) as fh:
        raw: dict[str, Any] = yaml.safe_load(fh) or {}

    s = D2S2Scenario(_source_dir=path.parent)

    # meta
    m = raw.get("meta", {})
    s.meta = D2S2Meta(
        name        = str(m.get("name", path.stem)),
        description = str(m.get("description", "")),
        adcs_model  = str(m.get("adcs_model", "cubeadcs_gen2")),
    )

    # mode
    mode = str(raw.get("mode", "static")).lower()
    if mode not in {"static", "replay", "physics"}:
        raise ValueError(f"Unknown d2s2 mode {mode!r}. Valid: static | replay | physics")
    s.mode = mode

    # replay
    rp = raw.get("replay", {})
    s.replay = D2S2Replay(
        file        = str(rp.get("file", "")),
        time_column = str(rp.get("time_column", "UnixTime")),
        columns     = dict(rp.get("columns", {})),
        speed       = float(rp.get("speed", 1.0)),
        loop        = bool(rp.get("loop", True)),
    )

    # physics
    ph = raw.get("physics", {})
    inert = ph.get("inertia_kg_m2", {})
    s.physics = D2S2Physics(
        initial_quaternion = _list4(ph.get("initial_quaternion"), [1, 0, 0, 0]),
        initial_omega_rps  = _list3(ph.get("initial_omega_rps"),  [0, 0, 0]),
        initial_rw_rpm     = _list4(ph.get("initial_rw_rpm"),     [0, 0, 0, 0]),
        inertia_kg_m2      = D2S2Inertia(
            Ixx = float(inert.get("Ixx", 0.10)),
            Iyy = float(inert.get("Iyy", 0.20)),
            Izz = float(inert.get("Izz", 0.15)),
        ),
        rw_axis_matrix  = ph.get("rw_axis_matrix", [[1,0,0],[0,1,0],[0,0,1],[0.577,0.577,0.577]]),
        b_field_body_ut = _list3(ph.get("b_field_body_ut"), [23.0, -15.0, 42.0]),
    )

    # static
    st = raw.get("static", {})
    s.static = D2S2Static(
        state_machine_mode = str(st.get("state_machine_mode", "STANDBY")).upper(),
        quaternion         = _list4(st.get("quaternion"),       [1, 0, 0, 0]),
        angular_rate_rps   = _list3(st.get("angular_rate_rps"), [0, 0, 0]),
        rw_speeds_rpm      = _list4(st.get("rw_speeds_rpm"),    [0, 0, 0, 0]),
        mag_ut             = _list3(st.get("mag_ut"),            [23.0, -15.0, 42.0]),
    )

    # initial_state
    ist = raw.get("initial_state", {})
    s.initial_state = D2S2InitialState(
        state_machine_mode = str(ist.get("state_machine_mode",
                                         s.static.state_machine_mode)).upper(),
        rw_speeds_rpm      = _list4(ist.get("rw_speeds_rpm"), [0, 0, 0, 0]),
    )

    # telemetry
    tm = raw.get("telemetry", {})
    s.telemetry = D2S2Telemetry(
        interval_ms = int(tm.get("interval_ms", 200)),
    )

    return s


# ── Helpers ────────────────────────────────────────────────────────────────────

def _list3(val: Any, default: list[float]) -> list[float]:
    if val is None:
        return list(default)
    lst = [float(x) for x in val]
    if len(lst) < 3:
        lst += default[len(lst):]
    return lst[:3]


def _list4(val: Any, default: list[float]) -> list[float]:
    if val is None:
        return list(default)
    lst = [float(x) for x in val]
    if len(lst) < 4:
        lst += default[len(lst):]
    return lst[:4]
