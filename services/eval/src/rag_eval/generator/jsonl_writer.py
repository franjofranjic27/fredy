import json
import os
import time
from collections.abc import Sequence
from pathlib import Path

from rag_eval.generator.models import GoldenRecord


def write_jsonl(path: str | Path, records: Sequence[GoldenRecord]) -> None:
    """Serialize records to JSONL and write atomically.

    Write-then-rename because a half-finished ``.jsonl`` is worse than no file
    at all — downstream eval runs would silently load a partial dataset.
    ``os.replace`` within the same directory is atomic on POSIX, so readers
    either see the previous file or the complete new one.
    """
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    temp_path = target.with_name(f"{target.name}.tmp-{os.getpid()}-{time.time_ns()}")

    lines = [json.dumps(record.to_json_dict(), ensure_ascii=False) for record in records]
    body = "\n".join(lines) + ("\n" if records else "")

    temp_path.write_text(body, encoding="utf-8")
    os.replace(temp_path, target)
