import os
import json

class TaskFileSource:
    def __init__(self, directory):
        self.directory = directory
        self.processed = set()

    def get_next_task(self):
        files = sorted(os.listdir(self.directory))
        for filename in files:
            if not filename.endswith('.json'):
                continue
            filepath = os.path.join(self.directory, filename)
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
