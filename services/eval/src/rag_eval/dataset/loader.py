import json
from pathlib import Path

from pydantic import ValidationError

from rag_eval.dataset.models import EvalCase


class DatasetNotFoundError(Exception):
    def __init__(self, path: str) -> None:
        super().__init__(
            f'Eval dataset not found at "{path}". '
            "Run the dataset generator first: `rag-eval generate`."
        )
        self.path = path


class DatasetParseError(Exception):
    def __init__(self, path: str, line_number: int, reason: str) -> None:
        super().__init__(f"Invalid eval case in {path} at line {line_number}: {reason}")
        self.path = path
        self.line_number = line_number
        self.reason = reason


def load_dataset(path: str | Path) -> list[EvalCase]:
    """Load and validate a JSONL golden dataset.

    Blank lines are skipped; malformed JSON, schema violations, duplicate
    query ids and empty datasets abort with the offending line number.
    """
    absolute_path = Path(path).resolve()
    if not absolute_path.is_file():
        raise DatasetNotFoundError(str(absolute_path))

    cases: list[EvalCase] = []
    seen_ids: set[str] = set()
    line_number = 0

    with absolute_path.open(encoding="utf-8") as handle:
        for raw_line in handle:
            line_number += 1
            trimmed = raw_line.strip()
            if not trimmed:
                continue

            try:
                payload = json.loads(trimmed)
            except json.JSONDecodeError as error:
                raise DatasetParseError(
                    str(absolute_path), line_number, f"Malformed JSON: {error}"
                ) from error

            try:
                case = EvalCase.model_validate(payload)
            except ValidationError as error:
                issues = "; ".join(
                    f"{'.'.join(str(p) for p in issue['loc']) or '<root>'}: {issue['msg']}"
                    for issue in error.errors()
                )
                raise DatasetParseError(str(absolute_path), line_number, issues) from error

            if case.query_id in seen_ids:
                raise DatasetParseError(
                    str(absolute_path), line_number, f'Duplicate queryId "{case.query_id}"'
                )
            seen_ids.add(case.query_id)
            cases.append(case)

    if not cases:
        raise DatasetParseError(str(absolute_path), line_number, "Dataset is empty")

    return cases
