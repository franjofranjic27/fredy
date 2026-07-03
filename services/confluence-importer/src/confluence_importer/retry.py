"""Full-jitter exponential backoff retry, ported from the TS implementation."""

import random
import re
import time
from collections.abc import Callable

import httpx

_RETRYABLE_STATUS = re.compile(r"\b(429|500|502|503|504)\b")


def is_retryable(error: Exception) -> bool:
    """Retry on HTTP 429/5xx (matched in the message, like the TS version) and transport errors."""
    if isinstance(error, httpx.TransportError):
        return True
    return bool(_RETRYABLE_STATUS.search(str(error)))


def _full_jitter_delay(attempt: int, min_delay: float, max_delay: float) -> float:
    """Random delay in [0, min(cap, base * 2^attempt)]."""
    exponential = min(max_delay, min_delay * (2**attempt))
    return random.random() * exponential  # noqa: S311 - jitter, not crypto


def with_retry[T](
    fn: Callable[[], T],
    *,
    max_attempts: int = 5,
    min_delay: float = 1.0,
    max_delay: float = 30.0,
    retryable: Callable[[Exception], bool] = is_retryable,
    sleep: Callable[[float], None] | None = None,
) -> T:
    """Retry ``fn`` with full-jitter exponential backoff.

    Defaults match the TS implementation: 5 attempts, 1s-30s delay range.
    """
    do_sleep = sleep if sleep is not None else time.sleep
    last_error: Exception | None = None

    for attempt in range(max_attempts):
        try:
            return fn()
        except Exception as error:  # noqa: BLE001 - retryable() decides what propagates
            last_error = error
            is_last = attempt == max_attempts - 1
            if is_last or not retryable(error):
                raise
            do_sleep(_full_jitter_delay(attempt, min_delay, max_delay))

    raise last_error  # pragma: no cover - unreachable, loop always returns or raises
