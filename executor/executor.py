# Executor Logic (Placeholder)
import pika
import json
import time
import threading
import os
from datetime import datetime

AGENT_ID = "bench-01"
HEARTBEAT_INTERVAL = 5  # seconds
STATE_FILE = "executor_state.json"

abort_flag = threading.Event()

def load_state():
    if os.path.exists(STATE_FILE):
        with open(STATE_FILE, 'r') as f:
            return json.load(f)
    return {"current_task_id": None, "status": "ready", "current_cycle": 0}

def save_state(task_id, status, current_cycle):
    state = {
        "current_task_id": task_id,
        "status": status,
        "current_cycle": current_cycle,
        "updated_at": datetime.utcnow().isoformat() + "Z"
    }
    with open(STATE_FILE, 'w') as f:
        json.dump(state, f, indent=4)

def clear_state():
    if os.path.exists(STATE_FILE):
        os.remove(STATE_FILE)
        print("[Executor] Cleared executor state.")

def connect():
    return pika.BlockingConnection(pika.ConnectionParameters('localhost'))

def send_status(channel, status="ready"):
    status_message = {
        "agent_id": AGENT_ID,
        "status": status,
        "capabilities": ["BatteryTest"]
    }
    channel.basic_publish(
        exchange='agent_status',
        routing_key='bench-01.status',
        body=json.dumps(status_message)
    )
    print(f"[Executor] Sent status: {status}")

def heartbeat_loop():
    connection = connect()
    channel = connection.channel()
    channel.exchange_declare(exchange='agent_status', exchange_type='direct')
    try:
        while not abort_flag.is_set():
            state = load_state()
            send_status(channel, status=state.get("status", "ready"))
            time.sleep(HEARTBEAT_INTERVAL)
    finally:
        connection.close()

def task_callback(ch, method, properties, body):
    global abort_flag
    state = load_state()

    task = json.loads(body)
    task_id = task["task_id"]
    cycles = task["parameters"].get("cycles", 1)

    if state["current_task_id"] == task_id and state["status"] == "in_process":
        print(f"[Executor] Task {task_id} already in process. Ignoring duplicate.")
        ch.basic_ack(delivery_tag=method.delivery_tag)
        return

    print(f"[Executor] Starting new task: {task_id}")
    save_state(task_id, "in_process", 0)

    connection = connect()
    channel_result = connection.channel()
    channel_result.exchange_declare(exchange='results', exchange_type='direct')

    for cycle_num in range(1, cycles + 1):
        if abort_flag.is_set():
            print(f"[Executor] Task {task_id} aborted during cycle {cycle_num}!")
            save_state(task_id, "aborted", cycle_num)
            ch.basic_ack(delivery_tag=method.delivery_tag)
            connection.close()
            return

        temperature = 32.0 + cycle_num * 0.1
        current = 1.2
        voltage = 4.0 + cycle_num * 0.02

        result = {
            "agent_id": AGENT_ID,
            "task_id": task_id,
            "cycle_number": cycle_num,
            "result": "pass",
            "details": {
                "temperature": temperature,
                "current": current,
                "voltage": voltage,
                "measured_at": datetime.utcnow().isoformat() + "Z"
            }
        }

        channel_result.basic_publish(
            exchange='results',
            routing_key='bench-01.result',
            body=json.dumps(result)
        )
        print(f"[Executor] Sent result cycle {cycle_num}/{cycles} for task {task_id}: {result}")
        save_state(task_id, "in_process", cycle_num)
        time.sleep(1)

    clear_state()
    ch.basic_ack(delivery_tag=method.delivery_tag)
    connection.close()

def abort_callback(ch, method, properties, body):
    abort_message = json.loads(body)
    print(f"[Executor] 🚫 Received abort signal: {abort_message}")
    abort_flag.set()
    save_state(load_state().get("current_task_id"), "aborted", load_state().get("current_cycle"))
    ch.basic_ack(delivery_tag=method.delivery_tag)

def main():
    connection = connect()
    channel = connection.channel()

    channel.exchange_declare(exchange='tasks', exchange_type='direct')
    channel.exchange_declare(exchange='results', exchange_type='direct')
    channel.exchange_declare(exchange='agent_status', exchange_type='direct')
    channel.exchange_declare(exchange='abort', exchange_type='direct')

    channel.queue_declare(queue='bench-01')
    channel.queue_bind(exchange='tasks', queue='bench-01', routing_key='bench-01.task')

    channel.queue_declare(queue='bench-01.abort')
    channel.queue_bind(exchange='abort', queue='bench-01.abort', routing_key='bench-01.abort')

    heartbeat_thread = threading.Thread(target=heartbeat_loop, daemon=True)
    heartbeat_thread.start()

    channel.basic_consume(queue='bench-01', on_message_callback=task_callback)
    channel.basic_consume(queue='bench-01.abort', on_message_callback=abort_callback)



    print("[Executor] Waiting for tasks...")
    try:
        channel.start_consuming()
    except KeyboardInterrupt:
        print("[Executor] Stopping...")
        abort_flag.set()
        channel.stop_consuming()
    finally:
        connection.close()

if __name__ == "__main__":
    main()
