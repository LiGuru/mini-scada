import functools
import random
import pika
import json
import time
import threading
import os
from datetime import datetime, UTC

AGENT_ID    = os.environ.get('AGENT_ID',    'bench-01')
RABBIT_HOST = os.environ.get('RABBIT_HOST', 'localhost')
RABBIT_PORT = int(os.environ.get('RABBIT_PORT', '5672'))
RABBIT_USER = os.environ.get('RABBIT_USER', 'guest')
RABBIT_PASS = os.environ.get('RABBIT_PASS', 'guest')
RABBIT_VHOST = os.environ.get('RABBIT_VHOST', '/')

HEARTBEAT_INTERVAL = 5  # seconds
STATE_FILE = 'executor_state.json'

abort_flag = threading.Event()


# ------------------------------------------------------------------
# State persistence
# ------------------------------------------------------------------

def load_state() -> dict:
    if os.path.exists(STATE_FILE):
        with open(STATE_FILE, 'r') as f:
            return json.load(f)
    return {'current_task_id': None, 'status': 'ready', 'current_cycle': 0}


def save_state(task_id: str | None, status: str, current_cycle: int) -> None:
    state = {
        'current_task_id': task_id,
        'status': status,
        'current_cycle': current_cycle,
        'updated_at': datetime.now(UTC).isoformat() + 'Z',
    }
    with open(STATE_FILE, 'w') as f:
        json.dump(state, f, indent=4)


def clear_state() -> None:
    if os.path.exists(STATE_FILE):
        os.remove(STATE_FILE)
        print('[Executor] Cleared state.')


# ------------------------------------------------------------------
# RabbitMQ
# ------------------------------------------------------------------

def connect() -> pika.BlockingConnection:
    credentials = pika.PlainCredentials(RABBIT_USER, RABBIT_PASS)
    params = pika.ConnectionParameters(
        host=RABBIT_HOST,
        port=RABBIT_PORT,
        virtual_host=RABBIT_VHOST,
        credentials=credentials,
        heartbeat=60,
        blocked_connection_timeout=300,
    )
    return pika.BlockingConnection(params)


def publish_instruments(channel, scenario: str) -> None:
    """Publish bench instrument readings to the instruments exchange (independent of test results)."""
    data = {
        'agent_id': AGENT_ID,
        'timestamp': datetime.now(UTC).isoformat() + 'Z',
    }
    # All bench instruments always read regardless of scenario
    data |= use_load_measurement(current=0.14, voltage=3.8)
    data |= use_power_supply_measurement(current=0.55, voltage=4.0)
    data |= use_dmm_measurement(current=0.12, voltage=3.75, resistance=2.1)
    data |= use_rf_generator_measurement()
    data |= use_oscilloscope_measurement()
    data |= use_spectrum_analyzer_measurement()
    data |= use_temp_controller_measurement()
    data |= use_daq_measurement()
    channel.basic_publish(
        exchange='instruments',
        routing_key=f'{AGENT_ID}.instruments',
        body=json.dumps(data),
    )


def send_status(channel, status: str = 'ready') -> None:
    message = {
        'agent_id': AGENT_ID,
        'status': status,
        'capabilities': ['battery-cycle-check', 'uhf-signal-check', 'obc-health-check'],
    }
    channel.basic_publish(
        exchange='agent_status',
        routing_key=f'{AGENT_ID}.status',
        body=json.dumps(message),
    )
    print(f'[Executor] Status → {status}')


def heartbeat_loop() -> None:
    """Separate thread: publishes the current executor state every HEARTBEAT_INTERVAL seconds."""
    connection = connect()
    channel = connection.channel()
    channel.exchange_declare(exchange='agent_status', exchange_type='direct')
    try:
        while not abort_flag.is_set():
            state = load_state()
            send_status(channel, status=state.get('status', 'ready'))
            time.sleep(HEARTBEAT_INTERVAL)
    finally:
        connection.close()


# ------------------------------------------------------------------
# Instrument measurement placeholders
# ------------------------------------------------------------------

def _rand(lo: float = 1.0, hi: float = 1.99) -> float:
    return random.uniform(lo, hi)


def use_load_measurement(current: float = 0.0001, voltage: float = 0.001) -> dict:
    return {'load': {
        'current': round(current * _rand(), 6),
        'voltage': round(voltage * _rand(), 6),
        'measured_at': datetime.now(UTC).isoformat() + 'Z',
    }}


def use_power_supply_measurement(current: float = 0.0001, voltage: float = 0.001) -> dict:
    return {'power_supply': {
        'current': round(current * _rand(), 6),
        'voltage': round(voltage * _rand(), 6),
        'measured_at': datetime.now(UTC).isoformat() + 'Z',
    }}


def use_dmm_measurement(
    current: float = 0.0001,
    voltage: float = 0.001,
    resistance: float = 0.001,
) -> dict:
    return {'dmm': {
        'current': round(current * _rand(), 6),
        'voltage': round(voltage * _rand(), 6),
        'resistance': round(resistance * _rand(), 6),
        'measured_at': datetime.now(UTC).isoformat() + 'Z',
    }}


def use_rf_generator_measurement() -> dict:
    return {'rf_generator': {
        'frequency': round(random.uniform(430.0, 470.0), 3),
        'power':     round(random.uniform(-10.0, 10.0), 1),
        'measured_at': datetime.now(UTC).isoformat() + 'Z',
    }}


def use_oscilloscope_measurement() -> dict:
    return {'oscilloscope': {
        'frequency': round(random.uniform(1000.0, 9999.0), 1),
        'amplitude': round(random.uniform(0.5, 5.0), 3),
        'phase':     round(random.uniform(-180.0, 180.0), 1),
        'measured_at': datetime.now(UTC).isoformat() + 'Z',
    }}


def use_spectrum_analyzer_measurement() -> dict:
    return {'spectrum_analyzer': {
        'center_freq': round(random.uniform(432.0, 438.0), 1),
        'peak_power':  round(random.uniform(-60.0, -20.0), 1),
        'bandwidth':   round(random.uniform(0.5, 4.0), 2),
        'measured_at': datetime.now(UTC).isoformat() + 'Z',
    }}


def use_temp_controller_measurement() -> dict:
    return {'temp_controller': {
        'setpoint':   25.0,
        'actual':     round(random.uniform(22.5, 27.5), 1),
        'duty_cycle': round(random.uniform(0.0, 100.0), 0),
        'measured_at': datetime.now(UTC).isoformat() + 'Z',
    }}


def use_daq_measurement() -> dict:
    return {'daq': {
        'ch1': round(random.uniform(0.0, 3.3), 4),
        'ch2': round(random.uniform(0.0, 5.0), 4),
        'ch3': round(random.uniform(0.0, 12.0), 4),
        'ch4': round(random.uniform(-5.0, 5.0), 4),
        'measured_at': datetime.now(UTC).isoformat() + 'Z',
    }}


def use_eps_measurement() -> dict:
    return {'eps': {
        'battery_voltage': round(random.uniform(3.6, 4.2), 3),
        'battery_current': round(random.uniform(0.1, 2.5), 3),
        'soc': round(random.uniform(50.0, 100.0), 1),
        'temperature': round(random.uniform(20.0, 40.0), 1),
        'measured_at': datetime.now(UTC).isoformat() + 'Z',
    }}


def use_uhf_measurement() -> dict:
    return {'uhf': {
        'signal_strength': round(random.uniform(-80.0, -40.0), 1),
        'bitrate': random.choice([1200, 2400, 4800, 9600]),
        'rssi': round(random.uniform(-90.0, -50.0), 1),
        'measured_at': datetime.now(UTC).isoformat() + 'Z',
    }}


def use_obc_measurement() -> dict:
    return {'obc': {
        'cpu_load': round(random.uniform(5.0, 80.0), 1),
        'memory_used': round(random.uniform(20.0, 90.0), 1),
        'uptime': random.randint(0, 86400),
        'measured_at': datetime.now(UTC).isoformat() + 'Z',
    }}


# ------------------------------------------------------------------
# Task execution
# ------------------------------------------------------------------

def task_callback(ch, method, properties, body, *, result_channel) -> None:
    """
    Called by pika when a task message arrives.
    result_channel is the main channel, reused for publishing results
    (no per-task connection is opened).
    """
    state = load_state()
    task = json.loads(body)
    task_id = task['task_id']
    cycles = task.get('parameters', {}).get('cycles', 1)

    if state['current_task_id'] == task_id and state['status'] == 'in_process':
        print(f'[Executor] Task {task_id!r} already in process — ignoring duplicate.')
        ch.basic_ack(delivery_tag=method.delivery_tag)
        return

    print(f'[Executor] Starting task {task_id!r} ({cycles} cycles)')
    save_state(task_id, 'in_process', 0)

    scenario = task.get('scenario', '')

    for cycle_num in range(1, cycles + 1):
        if abort_flag.is_set():
            print(f'[Executor] Task {task_id!r} aborted at cycle {cycle_num}.')
            save_state(task_id, 'aborted', cycle_num)
            ch.basic_ack(delivery_tag=method.delivery_tag)
            return

        details: dict = {}

        # Instruments always publish on their own channel, independent of results
        publish_instruments(result_channel, scenario)

        match scenario:
            case 'battery-cycle-check':
                details |= use_eps_measurement()

            case 'uhf-signal-check':
                details |= use_uhf_measurement()

            case 'obc-health-check':
                details |= use_obc_measurement()

            case _:
                print(f'[Executor] Unknown scenario {scenario!r} — sending empty details.')

        result = {
            'agent_id': AGENT_ID,
            'task_id': task_id,
            'cycle_number': cycle_num,
            'total_cycles': cycles,
            'result': 'pass',
            'timestamp': datetime.now(UTC).isoformat() + 'Z',
            'details': details,
        }

        result_channel.basic_publish(
            exchange='results',
            routing_key=f'{AGENT_ID}.result',
            body=json.dumps(result),
        )
        print(f'[Executor] Cycle {cycle_num}/{cycles} sent for task {task_id!r}')
        save_state(task_id, 'in_process', cycle_num)
        time.sleep(1)

    clear_state()
    ch.basic_ack(delivery_tag=method.delivery_tag)


def abort_callback(ch, method, properties, body) -> None:
    msg = json.loads(body)
    print(f'[Executor] Abort signal received: {msg}')
    abort_flag.set()
    state = load_state()
    save_state(state.get('current_task_id'), 'aborted', state.get('current_cycle', 0))
    ch.basic_ack(delivery_tag=method.delivery_tag)


# ------------------------------------------------------------------
# Entry point
# ------------------------------------------------------------------

def main() -> None:
    connection = connect()
    channel = connection.channel()

    channel.exchange_declare(exchange='tasks', exchange_type='direct')
    channel.exchange_declare(exchange='results', exchange_type='direct')
    channel.exchange_declare(exchange='agent_status', exchange_type='direct')
    channel.exchange_declare(exchange='abort', exchange_type='direct')
    channel.exchange_declare(exchange='instruments', exchange_type='direct')

    task_queue = AGENT_ID
    abort_queue = f'{AGENT_ID}.abort'

    channel.queue_declare(queue=task_queue)
    channel.queue_bind(exchange='tasks', queue=task_queue, routing_key=f'{AGENT_ID}.task')

    channel.queue_declare(queue=abort_queue)
    channel.queue_bind(exchange='abort', queue=abort_queue, routing_key=f'{AGENT_ID}.abort')

    heartbeat_thread = threading.Thread(target=heartbeat_loop, daemon=True)
    heartbeat_thread.start()

    # Pass the main channel into task_callback so it reuses one connection.
    task_cb = functools.partial(task_callback, result_channel=channel)
    channel.basic_consume(queue=task_queue, on_message_callback=task_cb)
    channel.basic_consume(queue=abort_queue, on_message_callback=abort_callback)

    print(f'[Executor] Agent {AGENT_ID!r} waiting for tasks...')
    try:
        channel.start_consuming()
    except KeyboardInterrupt:
        print('[Executor] Stopping...')
        abort_flag.set()
        channel.stop_consuming()
    finally:
        connection.close()


if __name__ == '__main__':
    main()
