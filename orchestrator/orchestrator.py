import pika
import json
import time
import logging
import os
from datetime import datetime, UTC
from dataclasses import dataclass, field
from enum import Enum
try:
    from orchestrator.task_source import TaskFileSource
except ModuleNotFoundError:
    from task_source import TaskFileSource  # direct run: python orchestrator.py

logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] [%(levelname)s] [Orchestrator] %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
log = logging.getLogger('orchestrator')

READY_TIMEOUT = int(os.environ.get('READY_TIMEOUT', '30'))
AGENT_ID     = os.environ.get('AGENT_ID',    'bench-01')
RABBIT_HOST  = os.environ.get('RABBIT_HOST', 'localhost')
RABBIT_PORT  = int(os.environ.get('RABBIT_PORT', '5672'))
RABBIT_USER  = os.environ.get('RABBIT_USER', 'guest')
RABBIT_PASS  = os.environ.get('RABBIT_PASS', 'guest')
RABBIT_VHOST = os.environ.get('RABBIT_VHOST', '/')


class SessionState(Enum):
    WAITING_FOR_AGENT = 'waiting_for_agent'
    IDLE = 'idle'
    TASK_IN_PROGRESS = 'task_in_progress'
    ABORTED = 'aborted'


@dataclass
class TaskExecution:
    task: dict
    sent_at: datetime
    expected_cycles: int
    received_cycles: int = 0


state = SessionState.WAITING_FOR_AGENT
current_execution: TaskExecution | None = None
task_log: list[dict] = []
abort_reason = ''
task_source = TaskFileSource(work_directory='./tasks_inbox')


def connect():
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


def setup_gui_queues(channel, agent_id):
    channel.exchange_declare(exchange='gui_status', exchange_type='direct', durable=False)
    channel.exchange_declare(exchange='gui_results', exchange_type='direct', durable=False)
    channel.queue_declare(queue=f'gui_status.{agent_id}', durable=False)
    channel.queue_declare(queue=f'gui_results.{agent_id}', durable=False)
    channel.queue_bind(exchange='gui_status', queue=f'gui_status.{agent_id}', routing_key=f'{agent_id}.status')
    channel.queue_bind(exchange='gui_results', queue=f'gui_results.{agent_id}', routing_key=f'{agent_id}.result')


def forward_status_to_gui(channel, status):
    gui_message = {
        'agent_id': status['agent_id'],
        'status': status['status'],
        'timestamp': datetime.now(UTC).isoformat() + 'Z',
    }
    channel.basic_publish(
        exchange='gui_status',
        routing_key=f"{status['agent_id']}.status",
        body=json.dumps(gui_message),
    )


def forward_result_to_gui(channel, result):
    channel.basic_publish(
        exchange='gui_results',
        routing_key=f"{result['agent_id']}.result",
        body=json.dumps(result),
    )


def send_task(channel, task):
    channel.basic_publish(
        exchange='tasks',
        routing_key=f"{task['agent_id']}.task",
        body=json.dumps(task),
    )


def send_abort(channel, agent_id, reason, failed_task_id):
    abort_message = {'action': 'abort', 'reason': reason, 'failed_task_id': failed_task_id}
    channel.basic_publish(
        exchange='abort',
        routing_key=f'{agent_id}.abort',
        body=json.dumps(abort_message),
    )


def result_callback(ch, method, properties, body):
    global state, current_execution, abort_reason

    result = json.loads(body)
    task_id = result.get('task_id')
    result_status = result.get('result', 'unknown')
    cycle_number = result.get('cycle_number', 0)

    if current_execution is None or current_execution.task.get('task_id') != task_id:
        log.warning(f'Received result for unexpected task {task_id!r} — ignoring.')
        ch.basic_ack(delivery_tag=method.delivery_tag)
        return

    forward_result_to_gui(ch, result)
    current_execution.received_cycles += 1

    log_entry = next((t for t in task_log if t['task_id'] == task_id), None)
    if log_entry:
        log_entry['last_cycle'] = cycle_number

    if result_status != 'pass':
        state = SessionState.ABORTED
        abort_reason = f'Task {task_id} failed at cycle {cycle_number} (result={result_status})'
        log.error(abort_reason)
        send_abort(ch, result['agent_id'], abort_reason, task_id)
        if log_entry:
            log_entry['status'] = 'failed'
            log_entry['received_at'] = datetime.now(UTC).isoformat() + 'Z'
        ch.basic_ack(delivery_tag=method.delivery_tag)
        ch.stop_consuming()
        return

    if current_execution.received_cycles >= current_execution.expected_cycles:
        log.info(
            f'Task {task_id} completed successfully '
            f'({current_execution.received_cycles}/{current_execution.expected_cycles} cycles).'
        )
        task_source.after_task_complete(task_id)
        if log_entry:
            log_entry['status'] = 'pass'
            log_entry['received_at'] = datetime.now(UTC).isoformat() + 'Z'
        current_execution = None
        state = SessionState.IDLE

    ch.basic_ack(delivery_tag=method.delivery_tag)


def status_callback(ch, method, properties, body):
    global state

    status = json.loads(body)
    forward_status_to_gui(ch, status)

    if status.get('status') == 'ready' and state == SessionState.WAITING_FOR_AGENT:
        state = SessionState.IDLE
        log.info(f"Agent {status.get('agent_id')!r} is ready.")

    ch.basic_ack(delivery_tag=method.delivery_tag)


def save_log():
    log_data = {
        'tasks': task_log,
        'execution_status': state.value,
        'aborted_reason': abort_reason if state == SessionState.ABORTED else None,
    }
    with open('task_log.json', 'w') as f:
        json.dump(log_data, f, indent=4)
    log.info('Task log saved.')


def main():
    global state, current_execution

    connection = connect()
    channel = connection.channel()

    channel.exchange_declare(exchange='tasks', exchange_type='direct')
    channel.exchange_declare(exchange='results', exchange_type='direct')
    channel.exchange_declare(exchange='agent_status', exchange_type='direct')
    channel.exchange_declare(exchange='abort', exchange_type='direct')

    setup_gui_queues(channel, AGENT_ID)

    channel.queue_declare(queue='results')
    channel.queue_bind(exchange='results', queue='results', routing_key=f'{AGENT_ID}.result')

    channel.queue_declare(queue='orchestration_status')
    channel.queue_bind(exchange='agent_status', queue='orchestration_status', routing_key=f'{AGENT_ID}.status')

    channel.queue_declare(queue=f'{AGENT_ID}.abort')
    channel.queue_bind(exchange='abort', queue=f'{AGENT_ID}.abort', routing_key=f'{AGENT_ID}.abort')

    channel.basic_consume(queue='results', on_message_callback=result_callback)
    channel.basic_consume(queue='orchestration_status', on_message_callback=status_callback)

    log.info(f'Waiting for agent {AGENT_ID!r} READY signal (timeout={READY_TIMEOUT}s)...')

    try:
        start_time = time.time()
        while True:
            if state == SessionState.WAITING_FOR_AGENT:
                if time.time() - start_time > READY_TIMEOUT:
                    log.error('Timeout: no agent ready signal received. Exiting.')
                    break

            elif state == SessionState.IDLE:
                next_task = task_source.get_next_task()
                if next_task:
                    cycles = next_task.get('parameters', {}).get('cycles', 1)
                    current_execution = TaskExecution(
                        task=next_task,
                        sent_at=datetime.now(UTC),
                        expected_cycles=cycles,
                    )
                    task_log.append({
                        'task_id': next_task['task_id'],
                        'scenario': next_task.get('scenario'),
                        'sent_at': current_execution.sent_at.isoformat() + 'Z',
                        'status': 'sent',
                    })
                    state = SessionState.TASK_IN_PROGRESS
                    send_task(channel, next_task)
                    log.info(f"Sent task {next_task['task_id']!r} ({cycles} cycles expected)")

            elif state == SessionState.ABORTED:
                log.error(f'Session aborted: {abort_reason}')
                break

            connection.process_data_events(time_limit=1)

    except KeyboardInterrupt:
        log.info('Stopping orchestrator...')
        channel.stop_consuming()
    finally:
        connection.close()
        save_log()


if __name__ == '__main__':
    main()
