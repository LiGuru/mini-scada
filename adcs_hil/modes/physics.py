"""adcs_hil/modes/physics.py — Simplified rigid-body attitude dynamics.

Implements Euler's rotation equations for a spacecraft with 4 reaction wheels:

    I * ω̇ = τ_ctrl - ω × (I * ω + H_rw)
    q̇ = 0.5 * Ω(ω) * q

where:
    I       — spacecraft inertia tensor (diagonal, kg·m²)
    ω       — body angular velocity (rad/s)
    H_rw    — total angular momentum of reaction wheels (I_rw * ω_rw)
    τ_ctrl  — control torques from magnetorquers (simplified)
    q       — attitude quaternion [q0, q1, q2, q3], scalar-first

Reaction wheel model
    Simple spin-up model: ω_rw converges toward commanded speed
    with first-order dynamics (τ_rw = k * (ω_cmd - ω_rw)).

Magnetometer
    Uses a constant background dipole field rotated into the body frame
    via the current attitude quaternion.

Integration
    Fixed-step RK4 at 100 Hz internally; tick() may be called at any rate.
"""

from __future__ import annotations
import math
import time
from typing import Any

from ..d2s2 import D2S2Scenario
from .base import SimMode

_TWO_PI = 2.0 * math.pi
_RPM_TO_RPS = _TWO_PI / 60.0
_RPS_TO_RPM = 60.0 / _TWO_PI
_DT_SIM     = 0.01          # internal integration step (100 Hz)
_RW_INERTIA = 1.5e-4       # kg·m² per wheel (approximate for a small cubesat wheel)
_RW_TAU_S   = 5.0           # first-order RW time constant (seconds)
_UT_TO_T    = 1e-6          # µT → T conversion
_VALID_MODES = {"STANDBY", "DETUMBLING", "Y_WHEEL_MOMENTUM", "NADIR_POINTING",
                "SUN_TRACKING", "GROUND_TRACKING", "COMMISSIONING"}


class PhysicsMode(SimMode):
    """Rigid-body attitude dynamics with 4 reaction wheels."""

    def __init__(self, scenario: D2S2Scenario) -> None:
        ph = scenario.physics

        # Inertia (diagonal)
        self._Ixx = ph.inertia_kg_m2.Ixx
        self._Iyy = ph.inertia_kg_m2.Iyy
        self._Izz = ph.inertia_kg_m2.Izz

        # Attitude quaternion [q0, q1, q2, q3] scalar-first
        q = ph.initial_quaternion
        self._q = _normalize_q(q)

        # Body angular velocity (rad/s)
        w = ph.initial_omega_rps
        self._omega = [w[0], w[1], w[2]]

        # Reaction wheel angular velocities (rad/s)
        rw_rpm = ph.initial_rw_rpm
        self._rw_omega = [rpm * _RPM_TO_RPS for rpm in rw_rpm[:4]]
        self._rw_cmd   = list(self._rw_omega)   # commanded omega (rad/s)

        # Reaction wheel axis vectors (unit vectors in body frame)
        axes = ph.rw_axis_matrix
        self._rw_axes = [_normalize3(a) for a in axes[:4]]

        # Background magnetic field in inertial frame (µT)
        self._B_inertial = list(ph.b_field_body_ut)

        # B-dot controller gain  k  [A·m²·s/T]
        # Full law:  m = -k·Ḃ_body  (A·m²),  τ = m × B_body  (N·m)
        # For detumbling ~100 s on a ~1U-3U cubesat: k ≈ 5e5 A·m²·s/T
        self._bdot_k = 5e5

        self._state_machine = scenario.initial_state.state_machine_mode
        self._sim_time = 0.0
        self._b_prev   = self._mag_body()
        self._sim_mode_str = "physics"

    # ── SimMode interface ─────────────────────────────────────────────────────

    def tick(self, dt: float) -> dict[str, Any]:
        # Integrate at internal rate
        steps = max(1, int(round(dt / _DT_SIM)))
        dt_step = dt / steps
        for _ in range(steps):
            self._step(dt_step)
        self._sim_time += dt

        rw_rpm = [w * _RPS_TO_RPM for w in self._rw_omega]
        b = self._mag_body()

        return {
            "q0": round(self._q[0], 6),
            "q1": round(self._q[1], 6),
            "q2": round(self._q[2], 6),
            "q3": round(self._q[3], 6),
            "wx_rps": round(self._omega[0], 6),
            "wy_rps": round(self._omega[1], 6),
            "wz_rps": round(self._omega[2], 6),
            "rw0_rpm": round(rw_rpm[0], 2),
            "rw1_rpm": round(rw_rpm[1], 2),
            "rw2_rpm": round(rw_rpm[2], 2),
            "rw3_rpm": round(rw_rpm[3], 2),
            "mag_x_ut": round(b[0], 3),
            "mag_y_ut": round(b[1], 3),
            "mag_z_ut": round(b[2], 3),
            "state_machine": self._state_machine,
            "sim_mode": "physics",
            "sim_time_s": round(self._sim_time, 1),
        }

    def apply_command(self, cmd: str, args: dict[str, Any]) -> str:
        if cmd == "set_mode":
            mode = str(args.get("mode", "")).upper()
            if mode not in _VALID_MODES:
                raise ValueError(f"Unknown ADCS mode {mode!r}.")
            self._state_machine = mode
            return f"State machine → {mode}"

        if cmd == "set_rw_speed":
            idx  = int(args.get("wheel", 0))
            rpm  = float(args.get("speed_rpm", 0.0))
            if idx < 0 or idx > 3:
                raise ValueError("wheel must be 0–3")
            self._rw_cmd[idx] = rpm * _RPM_TO_RPS
            return f"RW{idx} commanded → {rpm:.1f} RPM"

        if cmd == "reset":
            self._omega = [0.0, 0.0, 0.0]
            self._rw_omega = [0.0, 0.0, 0.0, 0.0]
            self._rw_cmd   = [0.0, 0.0, 0.0, 0.0]
            self._q = [1.0, 0.0, 0.0, 0.0]
            self._state_machine = "STANDBY"
            return "Physics reset"

        if cmd == "set_attitude":
            q = args.get("quaternion", [])
            if len(q) == 4:
                self._q = _normalize_q([float(x) for x in q])
                return "Attitude set"
            raise ValueError("quaternion must be [q0,q1,q2,q3]")

        raise ValueError(f"Unknown command: {cmd!r}")

    # ── Integration step (RK4 for attitude, Euler for rates) ─────────────────

    def _step(self, dt: float) -> None:
        if dt <= 0.0:
            return
        omega = self._omega
        q     = self._q

        # RW angular momentum in body frame
        H_rw = [0.0, 0.0, 0.0]
        for i, axis in enumerate(self._rw_axes):
            h_mag = _RW_INERTIA * self._rw_omega[i]
            H_rw[0] += h_mag * axis[0]
            H_rw[1] += h_mag * axis[1]
            H_rw[2] += h_mag * axis[2]

        # Control torque — full B-dot law:
        #   m = −k · Ḃ_body  (A·m²)
        #   τ = m × B_body   (N·m)
        # B stored in µT; convert to T for physical units.
        tau_ctrl = [0.0, 0.0, 0.0]
        if self._state_machine == "DETUMBLING":
            b_uT = self._mag_body()                               # µT
            b_T  = [x * _UT_TO_T for x in b_uT]                  # T
            bdot_T = [(b_uT[i] - self._b_prev[i]) * _UT_TO_T / dt
                      for i in range(3)]                          # T/s
            self._b_prev = b_uT
            m = [-self._bdot_k * bdot_T[i] for i in range(3)]    # A·m²
            tau_ctrl = _cross(m, b_T)                             # N·m

        # Euler equations: I · ω̇ = τ − ω × (I·ω + H_rw)
        Iomega = [self._Ixx * omega[0], self._Iyy * omega[1], self._Izz * omega[2]]
        Iomega_plus_Hrw = [Iomega[i] + H_rw[i] for i in range(3)]
        cross = _cross(omega, Iomega_plus_Hrw)

        omega_dot = [
            (tau_ctrl[0] - cross[0]) / self._Ixx,
            (tau_ctrl[1] - cross[1]) / self._Iyy,
            (tau_ctrl[2] - cross[2]) / self._Izz,
        ]

        # Integrate omega (Euler)
        self._omega = [omega[i] + omega_dot[i] * dt for i in range(3)]

        # Integrate quaternion (RK4) using the omega from the START of the step
        self._q = _integrate_quaternion(q, omega, dt)

        # Reaction wheels: first-order spin-up toward commanded speed
        for i in range(4):
            err = self._rw_cmd[i] - self._rw_omega[i]
            self._rw_omega[i] += (err / _RW_TAU_S) * dt

    # ── Magnetometer ──────────────────────────────────────────────────────────

    def _mag_body(self) -> list[float]:
        """Rotate inertial B-field into body frame using current quaternion."""
        return _rotate_vec_by_q_inv(self._B_inertial, self._q)


# ── Math helpers ───────────────────────────────────────────────────────────────

def _normalize_q(q: list[float]) -> list[float]:
    n = math.sqrt(sum(x*x for x in q))
    if n < 1e-12:
        return [1.0, 0.0, 0.0, 0.0]
    return [x / n for x in q]


def _normalize3(v: list[float]) -> list[float]:
    n = math.sqrt(sum(x*x for x in v))
    if n < 1e-12:
        return [1.0, 0.0, 0.0]
    return [x / n for x in v]


def _cross(a: list[float], b: list[float]) -> list[float]:
    return [
        a[1]*b[2] - a[2]*b[1],
        a[2]*b[0] - a[0]*b[2],
        a[0]*b[1] - a[1]*b[0],
    ]


def _integrate_quaternion(q: list[float], omega: list[float], dt: float) -> list[float]:
    """RK4 integration of q_dot = 0.5 * Omega(omega) * q."""
    def qdot(q_: list[float]) -> list[float]:
        wx, wy, wz = omega
        q0, q1, q2, q3 = q_
        return [
            0.5 * (-wx*q1 - wy*q2 - wz*q3),
            0.5 * ( wx*q0 + wz*q2 - wy*q3),
            0.5 * ( wy*q0 - wz*q1 + wx*q3),
            0.5 * ( wz*q0 + wy*q1 - wx*q2),
        ]

    k1 = qdot(q)
    k2 = qdot([q[i] + 0.5*dt*k1[i] for i in range(4)])
    k3 = qdot([q[i] + 0.5*dt*k2[i] for i in range(4)])
    k4 = qdot([q[i] +     dt*k3[i] for i in range(4)])
    q_new = [q[i] + (dt/6.0)*(k1[i] + 2*k2[i] + 2*k3[i] + k4[i]) for i in range(4)]
    return _normalize_q(q_new)


def _rotate_vec_by_q_inv(v: list[float], q: list[float]) -> list[float]:
    """Rotate vector v from inertial frame to body frame.

    C_body_from_inertial(q):
        row0 = [q0²+q1²-q2²-q3², 2(q1q2+q0q3),   2(q1q3-q0q2)  ]
        row1 = [2(q1q2-q0q3),     q0²-q1²+q2²-q3², 2(q2q3+q0q1)  ]
        row2 = [2(q1q3+q0q2),     2(q2q3-q0q1),    q0²-q1²-q2²+q3²]
    v_body = C * v_inertial
    """
    q0, q1, q2, q3 = q
    C00 = q0**2 + q1**2 - q2**2 - q3**2
    C01 = 2*(q1*q2 + q0*q3)
    C02 = 2*(q1*q3 - q0*q2)
    C10 = 2*(q1*q2 - q0*q3)
    C11 = q0**2 - q1**2 + q2**2 - q3**2
    C12 = 2*(q2*q3 + q0*q1)
    C20 = 2*(q1*q3 + q0*q2)
    C21 = 2*(q2*q3 - q0*q1)
    C22 = q0**2 - q1**2 - q2**2 + q3**2
    return [
        C00*v[0] + C01*v[1] + C02*v[2],
        C10*v[0] + C11*v[1] + C12*v[2],
        C20*v[0] + C21*v[1] + C22*v[2],
    ]
