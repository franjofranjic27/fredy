import asyncio
import random

from rag_eval.generator.concurrency import map_with_concurrency


async def test_preserves_input_order_in_the_output() -> None:
    async def mapper(n: int, _index: int) -> int:
        await asyncio.sleep(random.random() * 0.005)
        return n * 10

    result = await map_with_concurrency([1, 2, 3, 4, 5], 2, mapper)
    assert result == [10, 20, 30, 40, 50]


async def test_never_runs_more_than_limit_mappers_in_parallel() -> None:
    active = 0
    peak = 0

    async def mapper(n: int, _index: int) -> int:
        nonlocal active, peak
        active += 1
        peak = max(peak, active)
        await asyncio.sleep(0.005)
        active -= 1
        return n

    await map_with_concurrency([1, 2, 3, 4, 5, 6, 7, 8], 3, mapper)
    assert peak <= 3


async def test_returns_none_at_indexes_where_the_mapper_threw() -> None:
    async def mapper(n: int, _index: int) -> int:
        if n == 2:
            raise RuntimeError("nope")
        return n

    result = await map_with_concurrency([1, 2, 3], 2, mapper)
    assert result == [1, None, 3]


async def test_handles_empty_input() -> None:
    async def mapper(n: int, _index: int) -> int:
        return n

    result = await map_with_concurrency([], 4, mapper)
    assert result == []
