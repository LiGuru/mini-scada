"""
mock_publisher.py — standalone mock data publisher for GUI testing.

Mimics a running executor without real hardware:
  - Instrument readings every 300 ms  (instruments exchange)
  - Agent status every 5 s            (agent_status exchange)
  - Fake task results every 3 s       (results exchange)

Usage:
    python3 mock_publisher.py

Env vars (same as executor):
    RABBIT_HOST, RABBIT_PORT, RABBIT_USER, RABBIT_PASS, RABBIT_VHOST, AGENT_ID
"""

import json
import os
import random
import time
import threading
from datetime import datetime, UTC

import pika

AGENT_ID     = os.environ.get('AGENT_ID',    'bench-01')
RABBIT_HOST  = os.environ.get('RABBIT_HOST', 'localhost')
RABBIT_PORT  = int(os.environ.get('RABBIT_PORT', '5672'))
RABBIT_USER  = os.environ.get('RABBIT_USER', 'guest')
RABBIT_PASS  = os.environ.get('RABBIT_PASS', 'guest')
RABBIT_VHOST = os.environ.get('RABBIT_VHOST', '/')

INSTR_INTERVAL  = 0.3   # seconds
STATUS_INTERVAL = 5.0
RESULT_INTERVAL = 3.0

SCENARIOS = [
    {'task_id': 'battery-cycle-check', 'scenario': 'battery-cycle-check', 'cycles': 5},
    {'task_id': 'uhf-signal-check',    'scenario': 'uhf-signal-check',    'cycles': 3},
    {'task_id': 'obc-health-check',    'scenario': 'obc-health-check',    'cycles': 4},
]


# ── Helpers ───────────────────────────────────────────────────────

def iso() -> str:
    return datetime.now(UTC).isoformat() + 'Z'

def rand(lo: float, hi: float) -> float:
    return round(random.uniform(lo, hi), 4)


# ── Payload builders ──────────────────────────────────────────────

def fake_instruments() -> dict:
    return {
        'agent_id':  AGENT_ID,
        'timestamp': iso(),
        'load': {
            'current':     rand(0.10, 0.22),
            'voltage':     rand(3.70, 4.10),
            'measured_at': iso(),
        },
        'power_supply': {
            'current':     rand(0.45, 0.75),
            'voltage':     rand(3.90, 4.20),
            'measured_at': iso(),
        },
        'dmm': {
            'current':    rand(0.09, 0.18),
            'voltage':    rand(3.65, 4.05),
            'resistance': rand(1.8, 2.6),
            'measured_at': iso(),
        },
        'rf_generator': {
            'frequency':   rand(430.0, 470.0),
            'power':       rand(-10.0, 10.0),
            'measured_at': iso(),
        },
        'oscilloscope': {
            'frequency':   rand(1000.0, 9999.0),
            'amplitude':   rand(0.5, 5.0),
            'phase':       rand(-180.0, 180.0),
            'measured_at': iso(),
        },
        'spectrum_analyzer': {
            'center_freq': rand(432.0, 438.0),
            'peak_power':  rand(-60.0, -20.0),
            'bandwidth':   rand(0.5, 4.0),
            'measured_at': iso(),
        },
        'temp_controller': {
            'setpoint':   25.0,
            'actual':     rand(22.5, 27.5),
            'duty_cycle': rand(0.0, 100.0),
            'measured_at': iso(),
        },
        'daq': {
            'ch1': rand(0.0,   3.3),
            'ch2': rand(0.0,   5.0),
            'ch3': rand(0.0,  12.0),
            'ch4': rand(-5.0,  5.0),
            'measured_at': iso(),
        },
    }


def fake_details(scenario: str) -> dict:
    if scenario == 'battery-cycle-check':
        return {'eps': {
            'battery_voltage': rand(3.6, 4.2),
            'battery_current': rand(0.5, 2.0),
            'soc':             rand(55.0, 98.0),
            'temperature':     rand(20.0, 38.0),
            'measured_at':     iso(),
        }}
    if scenario == 'uhf-signal-check':
        return {'uhf': {
            'signal_strength': rand(-75.0, -42.0),
            'bitrate':         random.choice([1200, 2400, 4800, 9600]),
            'rssi':            rand(-85.0, -48.0),
            'measured_at':     iso(),
        }}
    if scenario == 'obc-health-check':
        return {'obc': {
            'cpu_load':    rand(12.0, 72.0),
            'memory_used': rand(28.0, 85.0),
            'uptime':      random.randint(0, 86400),
            'measured_at': iso(),
        }}
    return {}


# ── Connection ────────────────────────────────────────────────────

def connect() -> pika.BlockingConnection:
    creds  = pika.PlainCredentials(RABBIT_USER, RABBIT_PASS)
    params = pika.ConnectionParameters(
        host=RABBIT_HOST, port=RABBIT_PORT,
        virtual_host=RABBIT_VHOST, credentials=creds,
        heartbeat=60,
    )
    return pika.BlockingConnection(params)


def setup_exchanges(ch):
    ch.exchange_declare(exchange='instruments',  exchange_type='direct', durable=False)
    ch.exchange_declare(exchange='agent_status', exchange_type='direct', durable=False)
    ch.exchange_declare(exchange='results',      exchange_type='direct', durable=False)
    # GUI queues
    for suffix in ('status', 'results', 'instruments'):
        ch.queue_declare(queue=f'gui_{suffix}.{AGENT_ID}', durable=False)
    ch.queue_bind(queue=f'gui_instruments.{AGENT_ID}',
                  exchange='instruments', routing_key=f'{AGENT_ID}.instruments')


# ── Publisher threads ─────────────────────────────────────────────

def instrument_loop():
    conn = connect()
    ch   = conn.channel()
    setup_exchanges(ch)
    print(f'[Mock] Instrument loop started ({INSTR_INTERVAL}s interval)')
    while True:
        ch.basic_publish(
            exchange='instruments',
            routing_key=f'{AGENT_ID}.instruments',
            body=json.dumps(fake_instruments()),
        )
        time.sleep(INSTR_INTERVAL)


def status_loop():
    conn = connect()
    ch   = conn.channel()
    setup_exchanges(ch)
    print(f'[Mock] Status loop started ({STATUS_INTERVAL}s interval)')
    while True:
        msg = {
            'agent_id':     AGENT_ID,
            'status':       'running',
            'capabilities': [s['scenario'] for s in SCENARIOS],
            'timestamp':    iso(),
        }
        ch.basic_publish(
            exchange='agent_status',
            routing_key=f'{AGENT_ID}.status',
            body=json.dumps(msg),
        )
        ch.basic_publish(
            exchange='',
            routing_key=f'gui_status.{AGENT_ID}',
            body=json.dumps(msg),
        )
        time.sleep(STATUS_INTERVAL)


def result_loop():
    conn = connect()
    ch   = conn.channel()
    setup_exchanges(ch)
    print(f'[Mock] Result loop started ({RESULT_INTERVAL}s interval)')
    scenario_idx = 0
    cycle        = 1
    while True:
        s      = SCENARIOS[scenario_idx % len(SCENARIOS)]
        result = {
            'agent_id':     AGENT_ID,
            'task_id':      s['task_id'],
            'cycle_number': cycle,
            'total_cycles': s['cycles'],
            'result':       'fail' if random.random() < 0.1 else 'pass',
            'timestamp':    iso(),
            'details':      fake_details(s['scenario']),
        }
        ch.basic_publish(
            exchange='results',
            routing_key=f'{AGENT_ID}.result',
            body=json.dumps(result),
        )
        ch.basic_publish(
            exchange='',
            routing_key=f'gui_results.{AGENT_ID}',
            body=json.dumps(result),
        )
        print(f'[Mock] {s["task_id"]} cycle {cycle}/{s["cycles"]}')
        cycle += 1
        if cycle > s['cycles']:
            cycle = 1
            scenario_idx += 1
        time.sleep(RESULT_INTERVAL)


# ── Main ──────────────────────────────────────────────────────────

if __name__ == '__main__':
    print(f'[Mock] Connecting to {RABBIT_HOST}:{RABBIT_PORT} as {RABBIT_USER}...')
    # Quick connectivity check
    try:
        test = connect()
        test.close()
        print(f'[Mock] Connected. Agent: {AGENT_ID}')
    except Exception as e:
        print(f'[Mock] Connection failed: {e}')
        raise SystemExit(1)

    for target in (instrument_loop, status_loop, result_loop):
        t = threading.Thread(target=target, daemon=True)
        t.start()

    print('[Mock] Running — Ctrl+C to stop')
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print('\n[Mock] Stopped.')
