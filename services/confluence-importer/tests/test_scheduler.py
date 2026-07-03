from datetime import UTC, datetime

import pytest

from confluence_importer.scheduler import run_scheduler


def test_rejects_invalid_cron_expression():
    with pytest.raises(ValueError, match="Invalid cron expression"):
        run_scheduler("not a cron", lambda: None)


def test_runs_job_on_schedule():
    runs: list[int] = []
    sleeps: list[float] = []

    run_scheduler(
        "0 */6 * * *",
        lambda: runs.append(1),
        now_fn=lambda: datetime(2024, 1, 1, 5, 0, tzinfo=UTC),
        sleep_fn=sleeps.append,
        max_iterations=2,
    )

    assert len(runs) == 2
    # 05:00 -> next run 06:00 = 3600s wait
    assert sleeps == [3600.0, 3600.0]


def test_job_failure_does_not_stop_the_loop():
    attempts: list[int] = []

    def failing_job() -> None:
        attempts.append(1)
        raise RuntimeError("sync failed")

    run_scheduler(
        "* * * * *",
        failing_job,
        now_fn=lambda: datetime(2024, 1, 1, tzinfo=UTC),
        sleep_fn=lambda _s: None,
        max_iterations=3,
    )

    assert len(attempts) == 3
