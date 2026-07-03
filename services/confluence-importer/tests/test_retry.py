import httpx
import pytest

from confluence_importer.retry import is_retryable, with_retry


def test_returns_result_on_first_success():
    assert with_retry(lambda: 42, sleep=lambda _s: None) == 42


def test_retries_retryable_errors_until_success():
    attempts = 0

    def flaky() -> str:
        nonlocal attempts
        attempts += 1
        if attempts < 3:
            raise RuntimeError("HTTP 503 Service Unavailable")
        return "ok"

    assert with_retry(flaky, sleep=lambda _s: None) == "ok"
    assert attempts == 3


def test_raises_immediately_on_non_retryable_error():
    attempts = 0

    def failing() -> None:
        nonlocal attempts
        attempts += 1
        raise RuntimeError("HTTP 404 Not Found")

    with pytest.raises(RuntimeError, match="404"):
        with_retry(failing, sleep=lambda _s: None)
    assert attempts == 1


def test_raises_after_max_attempts():
    attempts = 0

    def always_failing() -> None:
        nonlocal attempts
        attempts += 1
        raise RuntimeError("HTTP 500")

    with pytest.raises(RuntimeError, match="500"):
        with_retry(always_failing, max_attempts=3, sleep=lambda _s: None)
    assert attempts == 3


def test_sleeps_with_bounded_backoff():
    delays: list[float] = []
    attempts = 0

    def failing() -> None:
        nonlocal attempts
        attempts += 1
        raise RuntimeError("429 Too Many Requests")

    with pytest.raises(RuntimeError):
        with_retry(
            failing,
            max_attempts=4,
            min_delay=1.0,
            max_delay=4.0,
            sleep=delays.append,
        )

    assert len(delays) == 3  # no sleep after the final attempt
    for i, delay in enumerate(delays):
        assert 0 <= delay <= min(4.0, 1.0 * 2**i)


def test_custom_retryable_predicate():
    attempts = 0

    def failing() -> None:
        nonlocal attempts
        attempts += 1
        raise ValueError("custom")

    with pytest.raises(ValueError):
        with_retry(
            failing,
            max_attempts=3,
            retryable=lambda e: isinstance(e, ValueError),
            sleep=lambda _s: None,
        )
    assert attempts == 3


class TestIsRetryable:
    @pytest.mark.parametrize("code", [429, 500, 502, 503, 504])
    def test_http_status_codes_in_message(self, code: int):
        assert is_retryable(RuntimeError(f"API error ({code}): failed"))

    @pytest.mark.parametrize("code", [400, 401, 403, 404])
    def test_client_errors_are_not_retryable(self, code: int):
        assert not is_retryable(RuntimeError(f"API error ({code}): failed"))

    def test_transport_errors_are_retryable(self):
        assert is_retryable(httpx.ConnectError("connection refused"))
