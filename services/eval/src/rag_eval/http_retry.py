import asyncio
import time
from typing import Any

import httpx

RETRYABLE_STATUS_CODES = frozenset({429, 500, 502, 503, 504})
DEFAULT_MAX_ATTEMPTS = 3
DEFAULT_BACKOFF_SECONDS = 0.5


class ApiRequestError(Exception):
    """Raised when an upstream API call fails after all retry attempts."""

    def __init__(self, service: str, detail: str, status_code: int | None = None) -> None:
        suffix = f" ({status_code})" if status_code is not None else ""
        super().__init__(f"{service} request failed{suffix}: {detail}")
        self.service = service
        self.status_code = status_code


def post_with_retry(
    client: httpx.Client,
    url: str,
    *,
    service: str,
    json: dict[str, Any],
    headers: dict[str, str],
    max_attempts: int = DEFAULT_MAX_ATTEMPTS,
    backoff_seconds: float = DEFAULT_BACKOFF_SECONDS,
) -> dict[str, Any]:
    """POST with exponential backoff on 429/5xx and transport errors."""
    last_error: ApiRequestError | None = None
    for attempt in range(max_attempts):
        try:
            response = client.post(url, json=json, headers=headers)
        except httpx.TransportError as error:
            last_error = ApiRequestError(service, str(error))
        else:
            if response.status_code < 400:
                return response.json()
            last_error = ApiRequestError(service, response.text, response.status_code)
            if response.status_code not in RETRYABLE_STATUS_CODES:
                raise last_error
        if attempt < max_attempts - 1:
            time.sleep(backoff_seconds * 2**attempt)
    assert last_error is not None
    raise last_error


async def async_post_with_retry(
    client: httpx.AsyncClient,
    url: str,
    *,
    service: str,
    json: dict[str, Any],
    headers: dict[str, str],
    max_attempts: int = DEFAULT_MAX_ATTEMPTS,
    backoff_seconds: float = DEFAULT_BACKOFF_SECONDS,
) -> dict[str, Any]:
    """Async variant of :func:`post_with_retry`."""
    last_error: ApiRequestError | None = None
    for attempt in range(max_attempts):
        try:
            response = await client.post(url, json=json, headers=headers)
        except httpx.TransportError as error:
            last_error = ApiRequestError(service, str(error))
        else:
            if response.status_code < 400:
                return response.json()
            last_error = ApiRequestError(service, response.text, response.status_code)
            if response.status_code not in RETRYABLE_STATUS_CODES:
                raise last_error
        if attempt < max_attempts - 1:
            await asyncio.sleep(backoff_seconds * 2**attempt)
    assert last_error is not None
    raise last_error
