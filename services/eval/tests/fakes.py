"""Shared in-memory fakes for database-facing tests."""

from typing import Any


class FakeCursor:
    def __init__(self, rows: list[tuple[Any, ...]]) -> None:
        self._rows = rows

    def fetchall(self) -> list[tuple[Any, ...]]:
        return self._rows

    def fetchone(self) -> tuple[Any, ...] | None:
        return self._rows[0] if self._rows else None


class FakeConnection:
    """Replays canned results (or raises canned exceptions) per execute call."""

    def __init__(self, results: list[list[tuple[Any, ...]] | Exception]) -> None:
        self.calls: list[tuple[str, Any]] = []
        self._results = list(results)

    def execute(self, query: str, params: Any = None) -> FakeCursor:
        self.calls.append((query, params))
        result = self._results.pop(0)
        if isinstance(result, Exception):
            raise result
        return FakeCursor(result)
