# Orchestrator Logic (Placeholder)
import pika
import json
import time
from datetime import datetime, UTC
from task_source import TaskFileSource

READY_TIMEOUT = 30
execution_status = "running"
abort_reason = ""
agent_ready = False
agent_id = "bench-01"
task_log = []
task_source = TaskFileSource(work_directory='./tasks_inbox')

def connect():
    return pika.BlockingConnection(pika.ConnectionParameters('localhost'))

def setup_gui_queues(channel, agent_id):
    status_exchange = 'gui_status'
    result_exchange = 'gui_results'

    status_queue = f"gui_status.{agent_id}"
    result_queue = f"gui_results.{agent_id}"

    channel.exchange_declare(exchange=status_exchange, exchange_type='direct', durable=False)
    channel.exchange_declare(exchange=result_exchange, exchange_type='direct', durable=False)

    channel.queue_declare(queue=status_queue, durable=False)
    channel.queue_declare(queue=result_queue, durable=False)

    channel.queue_bind(exchange=status_exchange, queue=status_queue, routing_key=f"{agent_id}.status")
    channel.queue_bind(exchange=result_exchange, queue=result_queue, routing_key=f"{agent_id}.result")

def forward_status_to_gui(channel, status):
    routing_key = f"{status['agent_id']}.status"
    gui_message = {
        "agent_id": status["agent_id"],
        "status": status["status"],
        "timestamp": datetime.now(UTC).isoformat() + "Z"
    }
    channel.basic_publish(exchange='gui_status', routing_key=routing_key, body=json.dumps(gui_message))

def forward_result_to_gui(channel, result):
    routing_key = f"{result['agent_id']}.result"
    channel.basic_publish(exchange='gui_results', routing_key=routing_key, body=json.dumps(result))

def send_task(channel, task):
    routing_key = f"{task['agent_id']}.task"
    channel.basic_publish(exchange='tasks', routing_key=routing_key, body=json.dumps(task))

def send_abort(channel, reason, failed_task_id):
    abort_message = {"action": "abort", "reason": reason, "failed_task_id": failed_task_id}
    channel.basic_publish(exchange='abort', routing_key=f"{agent_id}.abort", body=json.dumps(abort_message))

def result_callback(ch, method, properties, body):
    global execution_status, abort_reason, task_source
    result = json.loads(body)
    task_id = result.get("task_id")
    status = result.get("result", "unknown")
    details = result.get("details", {})

    matching_task = next((t for t in task_log if t["task_id"] == task_id), None)
    if matching_task:
        matching_task.update({"received_at": datetime.now(UTC).isoformat() + "Z", "status": status, "details": details})
        forward_result_to_gui(ch, result)

        if status != "pass":
            execution_status = "aborted"
            abort_reason = f"Task {task_id} failed"
            send_abort(ch, abort_reason, task_id)
            ch.stop_consuming()
        task_source.after_task_complete(result)
        print(f"[Orchestrator] Task {task_id} completed successfully.")
    else:
        print(f"[Orchestrator] ⚠️ Unknown task_id: {task_id}")
    print(f"[Orchestrator] Received result for task {task_id}: {result}")
    ch.basic_ack(delivery_tag=method.delivery_tag)

def status_callback(ch, method, properties, body):
    global agent_ready
    status = json.loads(body)
    forward_status_to_gui(ch, status)

    if status.get("status") == "ready" and not agent_ready:
        agent_ready = True
    ch.basic_ack(delivery_tag=method.delivery_tag)

def save_log():
    log_data = {"tasks": task_log, "execution_status": execution_status, "aborted_reason": abort_reason if execution_status == "aborted" else None}
    with open("task_log.json", "w") as f:
        json.dump(log_data, f, indent=4)

def main():
    global agent_ready, task_source
    connection = connect()
    channel = connection.channel()

    channel.exchange_declare(exchange='tasks', exchange_type='direct')
    channel.exchange_declare(exchange='results', exchange_type='direct')
    channel.exchange_declare(exchange='agent_status', exchange_type='direct')
    channel.exchange_declare(exchange='abort', exchange_type='direct')

    setup_gui_queues(channel, agent_id)

    channel.queue_declare(queue='results')
    channel.queue_bind(exchange='results', queue='results', routing_key=f"{agent_id}.result")

    channel.queue_declare(queue='orchestration_status')
    channel.queue_bind(exchange='agent_status', queue='orchestration_status', routing_key=f"{agent_id}.status")

    channel.queue_declare(queue=f"{agent_id}.abort")
    channel.queue_bind(exchange='abort', queue=f"{agent_id}.abort", routing_key=f"{agent_id}.abort")

    channel.basic_consume(queue='results', on_message_callback=result_callback)
    channel.basic_consume(queue='orchestration_status', on_message_callback=status_callback)


    print("[Orchestrator] Waiting for agent READY signal...")

    try:
        start_time = time.time()
        while not agent_ready:
            if time.time() - start_time > READY_TIMEOUT:
                print("[Orchestrator] ❌ Timeout reached! No agent ready. Exiting.")
                connection.close()
                return
            connection.process_data_events(time_limit=1)

        print("[Orchestrator] Agent is ready, starting execution loop...")

        while True:
            next_task = task_source.get_next_task()
            if next_task:
                task_log.append({"task_id": next_task["task_id"], "scenario": next_task["scenario"], "sent_at": datetime.now(UTC).isoformat() + "Z", "status": "sent"})
                send_task(channel, next_task)
            connection.process_data_events(time_limit=1)
            time.sleep(1)  # Polling interval

    except KeyboardInterrupt:
        print("[Orchestrator] Stopping...")
        channel.stop_consuming()
    finally:
        connection.close()
        save_log()

if __name__ == "__main__":
    main()
