from .base    import SimMode
from .static  import StaticMode
from .replay  import ReplayMode
from .physics import PhysicsMode

__all__ = ["SimMode", "StaticMode", "ReplayMode", "PhysicsMode"]


def make_mode(scenario) -> SimMode:
    """Factory: create the correct SimMode from a D2S2Scenario."""
    if scenario.mode == "replay":
        return ReplayMode(scenario)
    if scenario.mode == "physics":
        return PhysicsMode(scenario)
    return StaticMode(scenario)
