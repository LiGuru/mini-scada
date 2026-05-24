"""
adcs_hil/hil_runner.py — ADCS Hardware-In-the-Loop runner.

Loads one or more d2s2 scenario files, starts simulating, and bridges
to RabbitMQ using the same AMQP topology as instruments/instr_runner.py.

AMQP topology (identical to instr_runner so the GUI sees it as instruments)
---------------------------------------------------------------------------
  Publishes telemetry   → exchange: instr_data,  rk: instr.{agent_id}.{instr_id}.data
  Publishes heartbeats  → exchange: instr_reg,   rk: instr.{agent_id}.{instr_id}.reg
  Consumes commands     ← exchange: instr_cmd,   queue: instr.{agent_id}.cmd
  Publishes replies     → exchange: instr_reply, rk: reply.{reply_to}

d2s2 scenario config
--------------------
  {
      "agent_id": "adcs-bench-01",
      "amqp_url": "amqp://...",
      "instruments": [
          {
              "id": "adcs1",
              "driver": "cubeadcs_gen2",
              "scenario": "adcs_hil/scenarios/detumbling.d2s2"
          }
      ]
  }

Usage
-----
  python -m adcs_hil.hil_runner --config adcs_hil/scenarios/bench.json
  python -m adcs_hil.hil_runner --config adcs_hil/scenarios/bench.json --mock
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
from pathlib import Path
from typing import Any

import pika
import pika.exceptions

log = logging.getLogger("adcs_hil")

# ── Constants ──────────────────────────────────────────────────────────────────

DATA_INTERVAL_S      = 0.2      # 5 Hz telemetry (ADCS publishes faster than lab instruments)
HEARTBEAT_INTERVAL_S = 10.0
RESERVE_TTL_S        = 60.0
CMD_QUEUE_TTL_MS     = 30_000
CMD_QUEUE_MAX_LEN    = 500
RECONNECT_DELAY_S    = 5.0

EX_DATA  = "instr_data"
EX_REG   = "instr_reg"
EX_CMD   = "instr_cmd"
EX_REPLY = "instr_reply"

# ── Domain types ───────────────────────────────────────────────────────────────

@dataclass
class _Reservation:
    token:       str
    reserved_by: str
    expires_at:  float


@dataclass
class AdcsEntry:
    instr_id:    str
    driver:      Any          # CubeAdcsGen2Driver | MockCubeAdcsGen2Driver
    reservation: _Reservation | None = None
    _lock:       threading.Lock = field(default_factory=threading.Lock, repr=False)

    def try_reserve(self, client_id: str) -> str | None:
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
        with self._lock:
            if self.reservation is None or self.reservation.token != token:
                return False
            self.reservation = None
            return True

    def validate_token(self, token: str) -> bool:
        with self._lock:
            self._tick_expiry()
            if self.reservation is None:
                return False
            ok = self.reservation.token == token
            if ok:
                self.reservation.expires_at = time.monotonic() + RESERVE_TTL_S
            return ok

    def _tick_expiry(self) -> None:
        if self.reservation and time.monotonic() > self.reservation.expires_at:
            self.reservation = None

    @property
    def reserved(self) -> bool:
        self._tick_expiry()
        return self.reservation is not None


# ── Runner ─────────────────────────────────────────────────────────────────────

class HilRunner:

    def __init__(self, config: dict, mock: bool = False) -> None:
        self._agent_id = config["agent_id"]
        self._amqp_url = config["amqp_url"]
        self._mock     = mock
        self._entries: dict[str, AdcsEntry] = {}

        self._pub_conn:  pika.BlockingConnection | None = None
        self._pub_chan:  Any = None
        self._con_conn:  pika.BlockingConnection | None = None
        self._con_chan:  Any = None
        self._pub_lock  = threading.Lock()
        self._shutdown  = threading.Event()

        self._load_instruments(config["instruments"])

    # ── Instrument loading ────────────────────────────────────────────────────

    def _load_instruments(self, specs: list[dict]) -> None:
        # Import here to avoid circular imports
        from .adcs_driver import CubeAdcsGen2Driver, MockCubeAdcsGen2Driver

        for spec in specs:
            instr_id = spec["id"]
            resource = "MOCK" if self._mock else spec.get("scenario", "MOCK")
            driver_cls = MockCubeAdcsGen2Driver if self._mock else CubeAdcsGen2Driver

            try:
                driver = driver_cls(resource)
                driver.connect()
                self._entries[instr_id] = AdcsEntry(instr_id=instr_id, driver=driver)
                log.info("Loaded ADCS HIL instrument %s (resource=%s)", instr_id, resource)
            except Exception as e:
                log.error("Failed to load %s: %s", instr_id, e)

    # ── Run ───────────────────────────────────────────────────────────────────

    def run(self) -> None:
        signal.signal(signal.SIGTERM, lambda *_: self._shutdown.set())
        signal.signal(signal.SIGINT,  lambda *_: self._shutdown.set())

        while not self._shutdown.is_set():
            try:
                self._connect_publisher()
                pub_thread = threading.Thread(target=self._publish_loop, daemon=True)
                pub_thread.start()
                self._consume_loop()        # blocks until disconnect
            except pika.exceptions.AMQPConnectionError as e:
                log.warning("AMQP connection lost: %s — reconnecting in %ss",
                            e, RECONNECT_DELAY_S)
                time.sleep(RECONNECT_DELAY_S)
            finally:
                self._close_connections()

        log.info("HIL runner stopped")

    # ── Publisher ─────────────────────────────────────────────────────────────

    def _connect_publisher(self) -> None:
        params = pika.URLParameters(self._amqp_url)
        params.heartbeat = 60
        self._pub_conn = pika.BlockingConnection(params)
        self._pub_chan = self._pub_conn.channel()
        self._pub_chan.exchange_declare(EX_DATA,  exchange_type="topic",  durable=True)
        self._pub_chan.exchange_declare(EX_REG,   exchange_type="topic",  durable=True)
        self._pub_chan.exchange_declare(EX_REPLY, exchange_type="topic",  durable=True)

    def _publish_loop(self) -> None:
        last_data = 0.0
        last_hb   = 0.0
        while not self._shutdown.is_set():
            now = time.monotonic()
            if now - last_data >= DATA_INTERVAL_S:
                self._publish_telemetry()
                last_data = now
            if now - last_hb >= HEARTBEAT_INTERVAL_S:
                self._publish_heartbeats()
                last_hb = now
            try:
                with self._pub_lock:
                    self._pub_conn.process_data_events(time_limit=0.01)
            except Exception:
                break
            time.sleep(0.01)

    def _publish_telemetry(self) -> None:
        for instr_id, entry in self._entries.items():
            try:
                data = entry.driver.read()
            except Exception as e:
                data = {"error": str(e)}
            payload = json.dumps({
                "agent_id": self._agent_id,
                "instr_id": instr_id,
                "data":     data,
            })
            rk = f"instr.{self._agent_id}.{instr_id}.data"
            self._safe_publish(EX_DATA, rk, payload)

    def _publish_heartbeats(self) -> None:
        for instr_id, entry in self._entries.items():
            payload = json.dumps({
                "agent_id":    self._agent_id,
                "instr_id":    instr_id,
                "model":       entry.driver.MODEL,
                "capabilities": entry.driver.CAPABILITIES,
                "reserved":    entry.reserved,
                "driver":      "cubeadcs_gen2",
            })
            rk = f"instr.{self._agent_id}.{instr_id}.reg"
            self._safe_publish(EX_REG, rk, payload)

    def _safe_publish(self, exchange: str, routing_key: str, body: str) -> None:
        def _do():
            self._pub_chan.basic_publish(
                exchange=exchange,
                routing_key=routing_key,
                body=body.encode(),
                properties=pika.BasicProperties(delivery_mode=1),
            )
        try:
            with self._pub_lock:
                self._pub_conn.add_callback_threadsafe(_do)
        except Exception as e:
            log.debug("Publish error: %s", e)

    # ── Consumer ─────────────────────────────────────────────────────────────

    def _consume_loop(self) -> None:
        params = pika.URLParameters(self._amqp_url)
        params.heartbeat = 60
        self._con_conn = pika.BlockingConnection(params)
        self._con_chan = self._con_conn.channel()
        self._con_chan.exchange_declare(EX_CMD, exchange_type="direct", durable=True)

        queue_name = f"instr.{self._agent_id}.cmd"
        self._con_chan.queue_declare(
            queue=queue_name, durable=True,
            arguments={
                "x-message-ttl":      CMD_QUEUE_TTL_MS,
                "x-max-length":       CMD_QUEUE_MAX_LEN,
                "x-overflow":         "drop-head",
            },
        )
        self._con_chan.queue_bind(queue=queue_name, exchange=EX_CMD,
                                  routing_key=queue_name)
        self._con_chan.basic_qos(prefetch_count=1)
        self._con_chan.basic_consume(queue=queue_name,
                                     on_message_callback=self._on_command,
                                     auto_ack=True)
        log.info("HIL runner '%s' consuming on %s", self._agent_id, queue_name)

        while not self._shutdown.is_set():
            self._con_conn.process_data_events(time_limit=0.5)

    def _on_command(self, ch, method, props, body: bytes) -> None:
        try:
            msg = json.loads(body)
        except json.JSONDecodeError:
            log.warning("Malformed command: %s", body[:120])
            return

        instr_id   = msg.get("instr_id", "")
        action     = msg.get("action", "")
        reply_to   = msg.get("reply_to", "")
        corr_id    = msg.get("correlation_id", "")
        token      = msg.get("token", "")
        entry      = self._entries.get(instr_id)

        def _reply(ok: bool, result: str, extra: dict | None = None) -> None:
            payload: dict = {
                "agent_id":       self._agent_id,
                "instr_id":       instr_id,
                "ok":             ok,
                "result":         result,
                "correlation_id": corr_id,
            }
            if extra:
                payload.update(extra)
            if reply_to:
                self._safe_publish(EX_REPLY, f"reply.{reply_to}",
                                   json.dumps(payload))

        if entry is None:
            _reply(False, f"Unknown instrument: {instr_id!r}")
            return

        if action == "reserve":
            client_id = props.reply_to or corr_id or "unknown"
            tok = entry.try_reserve(client_id)
            if tok:
                _reply(True, "Reserved", {"token": tok})
            else:
                _reply(False, "Already reserved")

        elif action == "release":
            ok = entry.try_release(token)
            _reply(ok, "Released" if ok else "Invalid token")

        elif action == "execute":
            if not entry.validate_token(token):
                _reply(False, "Invalid or expired token")
                return
            cmd  = msg.get("cmd", "")
            args = msg.get("args", {})
            try:
                result = entry.driver.execute(cmd, args)
                _reply(True, result)
            except Exception as e:
                _reply(False, str(e))

        else:
            _reply(False, f"Unknown action: {action!r}")

    def _close_connections(self) -> None:
        for conn in (self._pub_conn, self._con_conn):
            try:
                conn and conn.close()
            except Exception:
                pass
        self._pub_conn = self._con_conn = None


# ── Entry point ────────────────────────────────────────────────────────────────

def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
    )

    parser = argparse.ArgumentParser(description="ADCS HIL runner")
    parser.add_argument("--config", default="adcs_hil/scenarios/bench.json",
                        help="Path to bench config JSON")
    parser.add_argument("--mock", action="store_true",
                        help="Force mock mode (ignores scenario files)")
    args = parser.parse_args()

    config_path = Path(args.config)
    if not config_path.exists():
        sys.exit(f"Config not found: {config_path}")

    with open(config_path) as fh:
        config = json.load(fh)

    runner = HilRunner(config, mock=args.mock)
    runner.run()


if __name__ == "__main__":
    main()
