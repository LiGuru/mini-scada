"""
instruments/instr_runner.py — Bidirectional Keysight instrument runner.

Loads instrument configuration from instruments.json, connects each driver,
and bridges between RabbitMQ and VISA:

  Publishes telemetry   → exchange: instr_data,  rk: instr.{agent_id}.{instr_id}.data
  Publishes heartbeats  → exchange: instr_reg,   rk: instr.{agent_id}.{instr_id}.reg
  Consumes commands     ← exchange: instr_cmd,   queue: instr.{agent_id}.cmd
  Publishes replies     → exchange: instr_reply, rk: reply.{reply_to}

Reservation model
-----------------
  1. Client sends action="reserve"  → runner returns a secret token.
  2. All subsequent execute/release commands must carry that token.
  3. Reservation expires after RESERVE_TTL_S seconds of inactivity
     (each valid execute refreshes the TTL).
  4. Client can send action="release" + token to free the instrument early.

Actions (field "action" in command message)
-------------------------------------------
  reserve   — no extra fields required
  release   — requires "token"
  execute   — requires "token", "cmd", "args"

Usage
-----
  python -m instruments.instr_runner [--config instruments.json]
"""

from __future__ import annotations

import argparse
import json
import logging
import signal
import sys
import threading
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, UTC
from pathlib import Path
from typing import Any

import pika
import pika.exceptions

from .base import InstrumentDriver
from .keysight.power_supply import PowerSupply, MockPowerSupply
from .keysight.dmm import DMM, MockDMM
from .keysight.oscilloscope import Oscilloscope, MockOscilloscope
from .keysight.spectrum_analyzer import SpectrumAnalyzer, MockSpectrumAnalyzer
from .keysight.load import ElectronicLoad, MockElectronicLoad
from .keysight.rf_generator import RfGenerator, MockRfGenerator

log = logging.getLogger("instr_runner")

# ── Tunable constants ──────────────────────────────────────────────────────────

DATA_INTERVAL_S      = 2.0      # seconds between telemetry publishes
HEARTBEAT_INTERVAL_S = 10.0     # seconds between registration heartbeats
RESERVE_TTL_S        = 60.0     # reservation auto-expires after this many idle seconds
CMD_QUEUE_TTL_MS     = 30_000   # AMQP message TTL — stale commands are dropped
CMD_QUEUE_MAX_LEN    = 500      # hard cap to prevent unbounded queue growth
RECONNECT_DELAY_S    = 5.0      # seconds to wait before reconnecting after AMQP error

# ── Exchange names ─────────────────────────────────────────────────────────────

EX_DATA  = "instr_data"    # topic — telemetry
EX_REG   = "instr_reg"     # topic — registration / heartbeat
EX_CMD   = "instr_cmd"     # direct — commands (one queue per runner agent)
EX_REPLY = "instr_reply"   # topic — command replies (one per GUI session)

# ── Driver registry ────────────────────────────────────────────────────────────

DRIVER_MAP: dict[str, tuple[type[InstrumentDriver], type[InstrumentDriver]]] = {
    "power_supply":      (PowerSupply,       MockPowerSupply),
    "dmm":               (DMM,               MockDMM),
    "oscilloscope":      (Oscilloscope,      MockOscilloscope),
    "spectrum_analyzer": (SpectrumAnalyzer,  MockSpectrumAnalyzer),
    "load":              (ElectronicLoad,    MockElectronicLoad),
    "rf_generator":      (RfGenerator,       MockRfGenerator),
}

# ── Domain types ───────────────────────────────────────────────────────────────

@dataclass
class _Reservation:
    token:       str
    reserved_by: str    # opaque client identifier (GUI session id)
    expires_at:  float  # time.monotonic() deadline


@dataclass
class InstrumentEntry:
    """One live instrument — driver + reservation state."""
    instr_id:    str
    driver:      InstrumentDriver
    reservation: _Reservation | None = None
    _lock:       threading.Lock = field(default_factory=threading.Lock, repr=False)

    # ── Reservation helpers ──────────────────────────────────────────

    def try_reserve(self, client_id: str) -> str | None:
        """Reserve if currently free. Returns new token, or None if taken."""
        with self._lock:
            self._tick_expiry()
            if self.reservation is not None:
                return None
            token = uuid.uuid4().hex
            self.reservation = _Reservation(
                token=token,
                reserved_by=client_id,
                expires_at=time.monotonic() + RESERVE_TTL_S,
            )
            return token

    def try_release(self, token: str) -> bool:
        """Release reservation. Returns True on success, False on wrong token."""
        with self._lock:
            if self.reservation and self.reservation.token == token:
                self.reservation = None
                return True
            return False

    def validate_token(self, token: str) -> bool:
        """Check token, refresh TTL on success."""
        with self._lock:
            self._tick_expiry()
            if self.reservation is None or self.reservation.token != token:
                return False
            self.reservation.expires_at = time.monotonic() + RESERVE_TTL_S
            return True

    def reservation_info(self) -> dict[str, Any]:
        """Snapshot of reservation state (safe to serialize)."""
        with self._lock:
            self._tick_expiry()
            if self.reservation:
                return {
                    "reserved":    True,
                    "reserved_by": self.reservation.reserved_by,
                    "expires_in":  round(max(0.0, self.reservation.expires_at - time.monotonic()), 1),
                }
            return {"reserved": False}

    def _tick_expiry(self) -> None:
        """Expire stale reservation. Must be called under self._lock."""
        if self.reservation and time.monotonic() > self.reservation.expires_at:
            log.info(
                "Reservation expired: %s (was held by %s)",
                self.instr_id, self.reservation.reserved_by,
            )
            self.reservation = None


# ── Runner ─────────────────────────────────────────────────────────────────────

class InstrumentRunner:

    def __init__(self, config: dict[str, Any]) -> None:
        self._agent_id   = str(config["agent_id"])
        self._amqp_url   = str(config["amqp_url"])
        self._instruments: dict[str, InstrumentEntry] = {}
        self._stop       = threading.Event()

        self._load_instruments(config.get("instruments", []))

    # ── Lifecycle ─────────────────────────────────────────────────────────────

    def _load_instruments(self, specs: list[dict]) -> None:
        for spec in specs:
            instr_id   = spec["id"]
            driver_key = spec["driver"]
            resource   = spec.get("resource", "MOCK")
            use_mock   = spec.get("mock", False)

            if driver_key not in DRIVER_MAP:
                log.error("Unknown driver %r for %r — skipping", driver_key, instr_id)
                continue

            real_cls, mock_cls = DRIVER_MAP[driver_key]
            cls = mock_cls if use_mock else real_cls

            try:
                drv = cls(resource)
                drv.connect()
                self._instruments[instr_id] = InstrumentEntry(instr_id=instr_id, driver=drv)
                log.info(
                    "Connected: %-12s → %s  [%s]",
                    instr_id, drv.MODEL,
                    "mock" if use_mock else resource,
                )
            except Exception as exc:
                log.error("Failed to connect %s: %s", instr_id, exc)

    def _shutdown_instruments(self) -> None:
        for entry in self._instruments.values():
            try:
                entry.driver.disconnect()
            except Exception as exc:
                log.warning("Error disconnecting %s: %s", entry.instr_id, exc)

    # ── Main entry point ──────────────────────────────────────────────────────

    def run(self) -> None:
        """
        Start publisher daemon thread and run the consumer loop on the
        calling thread until stop() is called.
        """
        pub = threading.Thread(
            target=self._publish_loop,
            name="instr-publisher",
            daemon=True,
        )
        pub.start()

        while not self._stop.is_set():
            try:
                self._consume_loop()
            except pika.exceptions.AMQPConnectionError as exc:
                if self._stop.is_set():
                    break
                log.warning("Consumer AMQP error (%s), reconnecting in %ss…", exc, RECONNECT_DELAY_S)
                time.sleep(RECONNECT_DELAY_S)

    def stop(self) -> None:
        self._stop.set()

    # ── Publisher loop (background thread) ────────────────────────────────────

    def _publish_loop(self) -> None:
        """Periodically push telemetry and heartbeats. Reconnects on failure."""
        last_data = last_reg = 0.0
        conn = channel = None

        while not self._stop.is_set():
            if conn is None or conn.is_closed:
                try:
                    conn    = pika.BlockingConnection(pika.URLParameters(self._amqp_url))
                    channel = conn.channel()
                    self._declare_exchanges(channel)
                    log.info("[pub] AMQP connected")
                    last_reg = 0.0  # force immediate heartbeat on reconnect
                except Exception as exc:
                    log.warning("[pub] AMQP connect failed (%s), retry in %ss", exc, RECONNECT_DELAY_S)
                    conn = channel = None
                    time.sleep(RECONNECT_DELAY_S)
                    continue

            now = time.monotonic()

            try:
                if now - last_data >= DATA_INTERVAL_S:
                    self._publish_all_data(channel)
                    last_data = now

                if now - last_reg >= HEARTBEAT_INTERVAL_S:
                    self._publish_all_reg(channel)
                    last_reg = now

                conn.process_data_events(time_limit=0)

            except Exception as exc:
                log.warning("[pub] Publish error (%s), reconnecting…", exc)
                try:
                    conn.close()
                except Exception:
                    pass
                conn = channel = None
                continue

            time.sleep(0.2)

        if conn and not conn.is_closed:
            try:
                conn.close()
            except Exception:
                pass

    def _publish_all_data(self, ch) -> None:
        ts = datetime.now(UTC).isoformat() + 'Z'
        for instr_id, entry in self._instruments.items():
            try:
                data = entry.driver.read()
                self._publish(ch, EX_DATA, f"instr.{self._agent_id}.{instr_id}.data", {
                    "agent_id":  self._agent_id,
                    "instr_id":  instr_id,
                    "model":     entry.driver.MODEL,
                    "data":      data,
                    "timestamp": ts,
                })
            except Exception as exc:
                log.warning("Read error for %s: %s", instr_id, exc)

    def _publish_all_reg(self, ch) -> None:
        ts = datetime.now(UTC).isoformat() + 'Z'
        for instr_id, entry in self._instruments.items():
            self._publish_reg_one(ch, instr_id, entry, ts)

    def _publish_reg_one(self, ch, instr_id: str, entry: InstrumentEntry, ts: str | None = None) -> None:
        if ts is None:
            ts = datetime.now(UTC).isoformat() + 'Z'
        self._publish(ch, EX_REG, f"instr.{self._agent_id}.{instr_id}.reg", {
            "agent_id":     self._agent_id,
            "instr_id":     instr_id,
            "model":        entry.driver.MODEL,
            "capabilities": entry.driver.CAPABILITIES,
            "timestamp":    ts,
            **entry.reservation_info(),
        })

    # ── Consumer loop (calling thread) ────────────────────────────────────────

    def _consume_loop(self) -> None:
        conn    = pika.BlockingConnection(pika.URLParameters(self._amqp_url))
        ch      = conn.channel()
        self._declare_exchanges(ch)

        queue_name = f"instr.{self._agent_id}.cmd"
        ch.queue_declare(
            queue=queue_name,
            durable=True,
            arguments={
                "x-message-ttl":  CMD_QUEUE_TTL_MS,
                "x-max-length":   CMD_QUEUE_MAX_LEN,
            },
        )
        ch.queue_bind(queue=queue_name, exchange=EX_CMD, routing_key=queue_name)
        ch.basic_qos(prefetch_count=1)
        ch.basic_consume(queue=queue_name, on_message_callback=self._on_command, auto_ack=False)

        log.info("[cmd] Listening on queue %r", queue_name)

        while not self._stop.is_set():
            conn.process_data_events(time_limit=1.0)

        try:
            ch.stop_consuming()
        except Exception:
            pass
        conn.close()

    def _on_command(self, ch, method, props, body: bytes) -> None:
        ch.basic_ack(method.delivery_tag)

        try:
            msg = json.loads(body)
        except json.JSONDecodeError as exc:
            log.warning("Malformed command: %s", exc)
            return

        correlation_id = msg.get("correlation_id", "")
        reply_to       = msg.get("reply_to", "")
        instr_id       = msg.get("instr_id", "")
        action         = msg.get("action", "")
        token          = msg.get("token", "")

        log.debug("CMD  instr=%s action=%s reply_to=%s", instr_id, action, reply_to)

        def reply(ok: bool, result: str, **extra) -> None:
            if not reply_to:
                return
            payload: dict[str, Any] = {
                "correlation_id": correlation_id,
                "instr_id":       instr_id,
                "ok":             ok,
                "result":         result,
                "timestamp":      datetime.now(UTC).isoformat() + 'Z',
                **extra,
            }
            self._publish(ch, EX_REPLY, f"reply.{reply_to}", payload)

        entry = self._instruments.get(instr_id)
        if entry is None:
            reply(False, f"Unknown instrument: {instr_id!r}")
            return

        try:
            if action == "reserve":
                new_token = entry.try_reserve(client_id=reply_to or "unknown")
                if new_token:
                    reply(True, "Reserved", token=new_token)
                    log.info("Reserved  %s  ← %s", instr_id, reply_to)
                else:
                    info = entry.reservation_info()
                    reply(False, f"Already reserved by {info.get('reserved_by')!r}")

            elif action == "release":
                if entry.try_release(token):
                    reply(True, "Released")
                    log.info("Released  %s", instr_id)
                else:
                    reply(False, "Invalid or expired token")

            elif action == "execute":
                if not entry.validate_token(token):
                    reply(False, "Not reserved or token mismatch — reserve first")
                    return
                cmd  = str(msg.get("cmd", ""))
                args = msg.get("args", {})
                result = entry.driver.execute(cmd, args)
                reply(True, result)
                log.info("Executed  %s.%s(%s) → %s", instr_id, cmd, args, result)

            else:
                reply(False, f"Unknown action: {action!r}  (valid: reserve | release | execute)")

        except Exception as exc:
            log.exception("Command handler error for %s.%s:", instr_id, action)
            reply(False, f"Runner error: {exc}")

    # ── AMQP helpers ──────────────────────────────────────────────────────────

    @staticmethod
    def _declare_exchanges(ch) -> None:
        for name, ex_type in [
            (EX_DATA,  "topic"),
            (EX_REG,   "topic"),
            (EX_CMD,   "direct"),
            (EX_REPLY, "topic"),
        ]:
            ch.exchange_declare(exchange=name, exchange_type=ex_type, durable=True)

    @staticmethod
    def _publish(ch, exchange: str, routing_key: str, payload: dict) -> None:
        ch.basic_publish(
            exchange=exchange,
            routing_key=routing_key,
            body=json.dumps(payload),
            properties=pika.BasicProperties(
                content_type="application/json",
                delivery_mode=1,   # transient — speed over durability for live data
            ),
        )


# ── CLI ────────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="Mini-SCADA instrument runner")
    parser.add_argument(
        "--config", default="instruments.json",
        help="Path to instruments config JSON (default: instruments.json)",
    )
    parser.add_argument(
        "--log-level", default="INFO",
        choices=["DEBUG", "INFO", "WARNING", "ERROR"],
    )
    args = parser.parse_args()

    logging.basicConfig(
        level=getattr(logging, args.log_level),
        format="%(asctime)s [%(levelname)-8s] %(name)s: %(message)s",
    )

    config_path = Path(args.config)
    if not config_path.exists():
        log.error("Config file not found: %s", config_path)
        sys.exit(1)

    with config_path.open() as fh:
        config = json.load(fh)

    runner = InstrumentRunner(config)

    def _sig(signum, _frame):
        log.info("Signal %s — shutting down…", signum)
        runner.stop()

    signal.signal(signal.SIGINT,  _sig)
    signal.signal(signal.SIGTERM, _sig)

    log.info("Instrument runner starting  agent_id=%r", config["agent_id"])
    try:
        runner.run()
    finally:
        runner._shutdown_instruments()
        log.info("Instrument runner stopped.")


if __name__ == "__main__":
    main()
