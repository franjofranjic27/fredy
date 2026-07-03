import logging
from typing import Any

import pytest

from rag_eval.generator.rng import SeededRng
from rag_eval.generator.sampler import PgVectorSampler, derive_seed
from tests.fakes import FakeConnection


def make_row(page_id: str, idx: int, space_key: str = "DOCS") -> tuple[Any, ...]:
    return (
        f"{page_id}_{idx}",
        page_id,
        space_key,
        f"Page {page_id}",
        f"content {page_id}/{idx}",
        {
            "spaceName": "Docs",
            "headerPath": ["Section"],
            "chunkIndex": idx,
            "totalChunks": 3,
        },
    )


class TestSampleChunks:
    def test_maps_rows_into_sampled_chunks(self) -> None:
        rows = [make_row(f"p{i}", 0) for i in range(4)]
        conn = FakeConnection([[], rows])
        sampler = PgVectorSampler(conn, "chunks")

        sample = sampler.sample_chunks(4, SeededRng(1))

        assert len(sample) == 4
        assert sorted(c.chunk_id for c in sample) == ["p0_0", "p1_0", "p2_0", "p3_0"]
        assert sample[0].metadata.header_path == ("Section",)

    def test_seeds_postgres_from_the_rng(self) -> None:
        conn = FakeConnection([[], [make_row("p1", 0)]])
        sampler = PgVectorSampler(conn, "chunks")

        sampler.sample_chunks(1, SeededRng(42))

        sql, params = conn.calls[0]
        assert sql == "SELECT setseed(%s)"
        assert -1 <= params[0] <= 1

    def test_filters_out_rows_with_invalid_metadata_silently(self) -> None:
        broken = (*make_row("p2", 0)[:5], {"missing": True})
        conn = FakeConnection([[], [make_row("p1", 0), broken, make_row("p3", 0)]])
        sampler = PgVectorSampler(conn, "chunks")

        sample = sampler.sample_chunks(10, SeededRng(1))

        assert sorted(c.page_id for c in sample) == ["p1", "p3"]

    def test_keeps_rows_with_null_space_key_and_title(self) -> None:
        row = make_row("p1", 0)
        null_row = (row[0], row[1], None, None, row[4], row[5])
        conn = FakeConnection([[], [null_row]])
        sampler = PgVectorSampler(conn, "chunks")

        sample = sampler.sample_chunks(1, SeededRng(1))

        assert len(sample) == 1
        assert sample[0].metadata.space_key == ""
        assert sample[0].metadata.title == ""

    def test_warns_when_fewer_chunks_than_requested_are_sampled(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        conn = FakeConnection([[], [make_row("p1", 0)]])
        sampler = PgVectorSampler(conn, "chunks")

        with caplog.at_level(logging.WARNING):
            sample = sampler.sample_chunks(5, SeededRng(1))

        assert len(sample) == 1
        assert "Sampled only 1 of 5 requested chunks" in caplog.text

    def test_does_not_warn_when_request_is_satisfied(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        conn = FakeConnection([[], [make_row("p1", 0), make_row("p2", 0)]])
        sampler = PgVectorSampler(conn, "chunks")

        with caplog.at_level(logging.WARNING):
            sampler.sample_chunks(2, SeededRng(1))

        assert "requested chunks" not in caplog.text

    def test_applies_a_space_key_filter_when_provided(self) -> None:
        conn = FakeConnection([[], []])
        sampler = PgVectorSampler(conn, "chunks")

        sampler.sample_chunks(5, SeededRng(1), space_key="OPS")

        sql, params = conn.calls[1]
        assert "WHERE space_key = %s" in sql
        assert params == ["OPS", 5]

    def test_orders_randomly_with_limit(self) -> None:
        conn = FakeConnection([[], []])
        sampler = PgVectorSampler(conn, "chunks")

        sampler.sample_chunks(5, SeededRng(1))

        sql, params = conn.calls[1]
        assert "ORDER BY random() LIMIT %s" in sql
        assert params == [5]


class TestGetChunksByPageId:
    def test_returns_chunks_sorted_by_chunk_index(self) -> None:
        rows = [make_row("p1", 2), make_row("p1", 0), make_row("p1", 1)]
        conn = FakeConnection([rows])
        sampler = PgVectorSampler(conn, "chunks")

        chunks = sampler.get_chunks_by_page_id("p1")

        assert [c.metadata.chunk_index for c in chunks] == [0, 1, 2]

    def test_applies_a_page_id_filter(self) -> None:
        conn = FakeConnection([[]])
        sampler = PgVectorSampler(conn, "chunks")

        sampler.get_chunks_by_page_id("p42")

        sql, params = conn.calls[0]
        assert "WHERE page_id = %s" in sql
        assert params == ("p42",)


def test_derive_seed_maps_rng_draws_into_setseed_range() -> None:
    rng = SeededRng(7)
    for _ in range(50):
        assert -1 <= derive_seed(rng) <= 1
