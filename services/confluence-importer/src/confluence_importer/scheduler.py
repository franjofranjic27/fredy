"""Croniter-based sync scheduler loop."""

import logging
import time
from collections.abc import Callable
from datetime import UTC, datetime

from croniter import croniter

logger = logging.getLogger(__name__)


def run_scheduler(
    cron_expression: str,
    job: Callable[[], None],
    *,
    now_fn: Callable[[], datetime] = lambda: datetime.now(UTC),
    sleep_fn: Callable[[float], None] = time.sleep,
    max_iterations: int | None = None,
) -> None:
    """Run ``job`` on the given cron schedule, forever (or ``max_iterations`` times).

    A failing job is logged and does not stop the loop. Overlapping runs are
    impossible by construction: the loop is single-threaded and the next run is
    computed after the previous one finishes.
    """
    if not croniter.is_valid(cron_expression):
        raise ValueError(f"Invalid cron expression: {cron_expression!r}")

    logger.info("Scheduler started (cron=%s)", cron_expression)
    iterations = 0

    while max_iterations is None or iterations < max_iterations:
        now = now_fn()
        next_run = croniter(cron_expression, now).get_next(datetime)
        wait_seconds = max(0.0, (next_run - now).total_seconds())
        logger.info("Next sync at %s (in %.0fs)", next_run.isoformat(), wait_seconds)
        sleep_fn(wait_seconds)

        try:
            job()
        except Exception:
            logger.exception("Scheduled sync failed")

        iterations += 1
