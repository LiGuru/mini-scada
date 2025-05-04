import os
import json
from itertools import cycle


class TaskFileSource:
    def __init__(self, work_directory, *, processed_directory=None):
        self.work_directory = work_directory
        self.processed_directory = processed_directory or os.path.join(work_directory, 'processed')
        self.processed = set()

    def after_task_complete(self, result):
        if self.processed_directory and os.path.exists(self.processed_directory):
            try:
                os.makedirs(self.processed_directory, exist_ok=True)
                existing_file = os.path.join(self.work_directory, '{}.json'.format(result.get('task_id')))
                current_task = json.load(open(existing_file))
                expected_cycle = current_task.get('parameters').get('cycles')
                result_cycle = result.get('cycle_number')
                if expected_cycle == result_cycle:
                    print(f"[TaskSource] Moved task to processed: {existing_file}")
                    self.move_file_to_directory(existing_file)
            except Exception as e:
                print(f"[TaskSource] Error moving task to processed: {e}")
        else:
            print("[TaskSource] Processed directory not specified or does not exist.")

    def move_file_to_directory(self, file_exist):
        try:
            src = file_exist
            os.makedirs(os.path.dirname(self.processed_directory), exist_ok=True)

            dest = os.path.join(self.processed_directory, os.path.basename(src))
            os.rename(src, dest)
            print(f"[TaskSource] Moved file from {src} to {dest}")
        except Exception as e:
            print(f"[TaskSource] Error moving file: {e}")

    def get_next_task(self):
        files = sorted(os.listdir(self.work_directory))
        for filename in files:
            if not filename.endswith('.json'):
                continue
            filepath = os.path.join(self.work_directory, filename)
            if filepath in self.processed:
                continue

            with open(filepath, 'r') as f:
                try:
                    task = json.load(f)
                    self.processed.add(filepath)
                    print(f"[TaskSource] Loaded task from {filename}")
                    print(f"[TaskSource] Task details: {task}")
                    return task
                except Exception as e:
                    print(f"[TaskSource] Error reading {filename}: {e}")
                    self.processed.add(filepath)  # Avoid retrying broken files
        return None
