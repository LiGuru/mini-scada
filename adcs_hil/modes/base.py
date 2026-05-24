"""adcs_hil/modes/base.py — Abstract simulation mode interface."""

from __future__ import annotations
from abc import ABC, abstractmethod
from typing import Any


class SimMode(ABC):
    """Base class for all ADCS simulation modes.

    Subclasses advance the simulation and produce telemetry dicts
    that match the CubeADCS Gen2 state structure.
    """

    @abstractmethod
    def tick(self, dt: float) -> dict[str, Any]:
        """Advance simulation by dt seconds, return current telemetry dict."""

    @abstractmethod
    def apply_command(self, cmd: str, args: dict[str, Any]) -> str:
        """Apply a named command (e.g. set_mode). Returns human-readable result."""

    # Standard telemetry field names used by all modes
    FIELDS = (
        "q0", "q1", "q2", "q3",           # attitude quaternion, scalar-first
        "wx_rps", "wy_rps", "wz_rps",     # body angular velocity (rad/s)
        "rw0_rpm", "rw1_rpm",              # reaction wheel speeds (RPM)
        "rw2_rpm", "rw3_rpm",
        "mag_x_ut", "mag_y_ut", "mag_z_ut",  # magnetometer (µT)
        "state_machine",                   # mode string
        "sim_mode",                        # which SimMode subclass
    )
