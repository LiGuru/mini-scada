"""
instruments/base.py — Abstract base class for all instrument drivers.

Every driver must implement:
  connect()    — open VISA / mock connection
  disconnect() — release resources
  read()       — return current readings as a flat dict
  execute(cmd, args) — run a named command, return human-readable result string

Class-level attributes (define in subclass):
  MODEL        : str            — e.g. "Keysight E4438C"
  CAPABILITIES : dict[str, dict] — cmd_name → {arg_name: type_hint, ...}
"""

from __future__ import annotations
from abc import ABC, abstractmethod
from typing import Any


class InstrumentDriver(ABC):

    # Subclasses must override these
    MODEL: str = "Unknown"
    CAPABILITIES: dict[str, dict[str, str]] = {}

    def __init__(self, resource: str) -> None:
        """
        Args:
            resource: VISA resource string, e.g. "GPIB0::5::INSTR"
                      Ignored by mock drivers.
        """
        self._resource = resource

    # ── Lifecycle ──────────────────────────────────────────────────

    @abstractmethod
    def connect(self) -> None:
        """Open the instrument connection. Raises on failure."""

    @abstractmethod
    def disconnect(self) -> None:
        """Release the instrument connection."""

    # ── Data ──────────────────────────────────────────────────────

    @abstractmethod
    def read(self) -> dict[str, Any]:
        """
        Read current instrument state.
        Returns a flat dict with numeric / bool values plus a 'measured_at' ISO timestamp.
        Must not raise — return {'error': str(e)} on failure.
        """

    # ── Commands ──────────────────────────────────────────────────

    @abstractmethod
    def execute(self, cmd: str, args: dict[str, Any]) -> str:
        """
        Execute a named command.
        Returns a human-readable result string on success.
        Raises ValueError for unknown commands, RuntimeError for hardware errors.
        """

    # ── Helpers ───────────────────────────────────────────────────

    def capabilities_schema(self) -> dict[str, dict[str, str]]:
        """Return the CAPABILITIES dict (for registration messages)."""
        return self.CAPABILITIES

    def __repr__(self) -> str:
        return f"<{type(self).__name__} resource={self._resource!r}>"
