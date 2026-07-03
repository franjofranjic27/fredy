import asyncio
from collections.abc import Awaitable, Callable, Sequence


async def map_with_concurrency[T, R](
    items: Sequence[T],
    limit: int,
    mapper: Callable[[T, int], Awaitable[R]],
) -> list[R | None]:
    """Run an async mapper over items with at most ``limit`` concurrent calls.

    Preserves input order in the result regardless of completion order.
    Failures surface as ``None`` so the caller can skip individual items
    without aborting the whole run.
    """
    if not items:
        return []

    semaphore = asyncio.Semaphore(max(1, min(limit, len(items))))

    async def worker(index: int, item: T) -> R | None:
        async with semaphore:
            try:
                return await mapper(item, index)
            except Exception:
                return None

    return list(await asyncio.gather(*(worker(i, item) for i, item in enumerate(items))))
