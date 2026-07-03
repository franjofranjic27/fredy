import json
from pathlib import Path

import pytest

from rag_eval.generator.anthropic_client import ChunkContext
from rag_eval.generator.generate import (
    GeneratorConfig,
    ProgressEvent,
    format_query_id,
    generate_dataset,
)
from rag_eval.generator.models import GeneratedQuestion, SampledChunk, SampledChunkMetadata
from rag_eval.generator.rng import SeededRng


def chunk(page_id: str, idx: int, total: int = 2) -> SampledChunk:
    return SampledChunk(
        chunk_id=f"{page_id}_{idx}",
        page_id=page_id,
        content=f"content {page_id}/{idx}",
        metadata=SampledChunkMetadata(
            title=f"Page {page_id}",
            space_key="DOCS",
            space_name="Docs",
            header_path=("Section",),
            chunk_index=idx,
            total_chunks=total,
        ),
    )


class FakeSampler:
    def __init__(self, corpus: list[SampledChunk]) -> None:
        self._corpus = corpus
        self.by_page: dict[str, list[SampledChunk]] = {}
        for c in corpus:
            self.by_page.setdefault(c.page_id, []).append(c)

    def sample_chunks(
        self, n: int, rng: SeededRng, space_key: str | None = None
    ) -> list[SampledChunk]:
        shuffled = rng.shuffle(list(self._corpus))
        return shuffled[:n]

    def get_chunks_by_page_id(self, page_id: str) -> list[SampledChunk]:
        return sorted(self.by_page.get(page_id, []), key=lambda c: c.metadata.chunk_index)


class FakeLlm:
    model = "claude-sonnet-5"

    def __init__(self, fail_on_content: str | None = None) -> None:
        self.fail_on_content = fail_on_content
        self.calls: list[tuple[str, ChunkContext, int]] = []

    async def generate_questions(
        self, chunk_content: str, context: ChunkContext, count: int
    ) -> list[GeneratedQuestion]:
        self.calls.append((chunk_content, context, count))
        if self.fail_on_content is not None and self.fail_on_content in chunk_content:
            raise RuntimeError("boom")
        return [
            GeneratedQuestion(question=f"Q{i + 1} for {chunk_content}", rationale="because")
            for i in range(count)
        ]


def config(out_dir: Path, **overrides: object) -> GeneratorConfig:
    defaults: dict = {
        "num_chunks": 2,
        "questions_per_chunk": 1,
        "output_path": out_dir / "out.jsonl",
        "seed": 1,
        "concurrency": 2,
    }
    defaults.update(overrides)
    return GeneratorConfig(**defaults)


def test_format_query_id_zero_pads_to_three_digits() -> None:
    assert format_query_id(1) == "q_001"
    assert format_query_id(42) == "q_042"
    assert format_query_id(123) == "q_123"


def test_format_query_id_does_not_truncate_above_999() -> None:
    assert format_query_id(1000) == "q_1000"


async def test_writes_one_record_per_sampled_chunk(tmp_path: Path) -> None:
    corpus = [chunk("p1", 0), chunk("p1", 1), chunk("p2", 0)]
    cfg = config(tmp_path, num_chunks=2)

    records = await generate_dataset(cfg, FakeSampler(corpus), FakeLlm())

    assert len(records) == 2
    lines = [line for line in cfg.output_path.read_text(encoding="utf-8").split("\n") if line]
    assert len(lines) == 2


async def test_generates_m_questions_per_chunk(tmp_path: Path) -> None:
    corpus = [chunk("p1", 0), chunk("p2", 0)]
    cfg = config(tmp_path, num_chunks=2, questions_per_chunk=3)

    records = await generate_dataset(cfg, FakeSampler(corpus), FakeLlm())

    assert len(records) == 6
    assert [r.query_id for r in records] == [format_query_id(i) for i in range(1, 7)]


async def test_assigns_stable_zero_padded_query_ids(tmp_path: Path) -> None:
    corpus = [chunk("p1", 0), chunk("p2", 0), chunk("p3", 0)]
    cfg = config(tmp_path, num_chunks=3, concurrency=1)

    records = await generate_dataset(cfg, FakeSampler(corpus), FakeLlm())

    assert [r.query_id for r in records] == ["q_001", "q_002", "q_003"]


async def test_is_deterministic_given_the_same_seed(tmp_path: Path) -> None:
    corpus = [chunk(f"p{i}", 0) for i in range(20)]

    run1 = await generate_dataset(
        config(tmp_path, num_chunks=5, seed=7, output_path=tmp_path / "a.jsonl"),
        FakeSampler(corpus),
        FakeLlm(),
    )
    run2 = await generate_dataset(
        config(tmp_path, num_chunks=5, seed=7, output_path=tmp_path / "b.jsonl"),
        FakeSampler(corpus),
        FakeLlm(),
    )

    assert [r.metadata["sourcePageId"] for r in run1] == [r.metadata["sourcePageId"] for r in run2]


async def test_different_seeds_produce_different_samples(tmp_path: Path) -> None:
    corpus = [chunk(f"p{i}", 0) for i in range(50)]

    run1 = await generate_dataset(
        config(tmp_path, num_chunks=5, seed=1, output_path=tmp_path / "a.jsonl"),
        FakeSampler(corpus),
        FakeLlm(),
    )
    run2 = await generate_dataset(
        config(tmp_path, num_chunks=5, seed=2, output_path=tmp_path / "b.jsonl"),
        FakeSampler(corpus),
        FakeLlm(),
    )

    assert [r.metadata["sourcePageId"] for r in run1] != [r.metadata["sourcePageId"] for r in run2]


async def test_includes_same_page_neighbour_chunks_in_relevant_chunk_ids(tmp_path: Path) -> None:
    corpus = [chunk("p1", 0, total=3), chunk("p1", 1, total=3), chunk("p1", 2, total=3)]
    sampler = FakeSampler(corpus)

    records = await generate_dataset(
        config(tmp_path, num_chunks=1, concurrency=1), sampler, FakeLlm()
    )

    assert len(records) == 1
    assert set(records[0].relevant_chunk_ids) == {"p1_0", "p1_1", "p1_2"}


async def test_source_chunk_comes_first_in_relevant_chunk_ids(tmp_path: Path) -> None:
    corpus = [chunk("p1", 1, total=2), chunk("p1", 0, total=2)]

    class SingleChunkSampler(FakeSampler):
        def sample_chunks(
            self, n: int, rng: SeededRng, space_key: str | None = None
        ) -> list[SampledChunk]:
            return [corpus[0]]  # p1_1

    records = await generate_dataset(
        config(tmp_path, num_chunks=1), SingleChunkSampler(corpus), FakeLlm()
    )

    assert records[0].relevant_chunk_ids[0] == "p1_1"
    assert set(records[0].relevant_chunk_ids) == {"p1_0", "p1_1"}


async def test_skips_chunks_when_the_llm_fails_but_completes_the_rest(tmp_path: Path) -> None:
    corpus = [chunk("p1", 0), chunk("p2", 0), chunk("p3", 0)]
    events: list[ProgressEvent] = []

    records = await generate_dataset(
        config(tmp_path, num_chunks=3, concurrency=1),
        FakeSampler(corpus),
        FakeLlm(fail_on_content="p2"),
        on_progress=events.append,
    )

    assert len(records) == 2
    skipped = [e for e in events if e.status == "skipped"]
    assert len(skipped) == 1
    assert skipped[0].reason == "boom"
    # Query ids stay dense despite the skip
    assert [r.query_id for r in records] == ["q_001", "q_002"]


async def test_emits_progress_events_for_every_chunk(tmp_path: Path) -> None:
    corpus = [chunk("p1", 0), chunk("p2", 0)]
    events: list[ProgressEvent] = []

    await generate_dataset(
        config(tmp_path, num_chunks=2, concurrency=1),
        FakeSampler(corpus),
        FakeLlm(),
        on_progress=events.append,
    )

    assert len(events) == 2
    assert events[0].index == 1
    assert events[0].total == 2
    assert events[0].status == "ok"


async def test_writes_empty_file_when_no_chunks_sampled(tmp_path: Path) -> None:
    cfg = config(tmp_path, num_chunks=5)

    records = await generate_dataset(cfg, FakeSampler([]), FakeLlm())

    assert records == []
    assert cfg.output_path.read_text(encoding="utf-8") == ""


async def test_record_metadata_carries_source_and_generator_info(tmp_path: Path) -> None:
    corpus = [chunk("p1", 0)]

    records = await generate_dataset(config(tmp_path, num_chunks=1), FakeSampler(corpus), FakeLlm())

    metadata = records[0].metadata
    assert metadata["sourcePageId"] == "p1"
    assert metadata["sourcePageTitle"] == "Page p1"
    assert metadata["sourceSpaceKey"] == "DOCS"
    assert metadata["generatedBy"] == "claude-sonnet-5"
    assert metadata["generatedAt"]
    assert metadata["rationale"] == "because"


async def test_written_jsonl_loads_as_a_valid_dataset(tmp_path: Path) -> None:
    from rag_eval.dataset.loader import load_dataset

    corpus = [chunk("p1", 0), chunk("p2", 0)]
    cfg = config(tmp_path, num_chunks=2, questions_per_chunk=2)

    await generate_dataset(cfg, FakeSampler(corpus), FakeLlm())

    cases = load_dataset(cfg.output_path)
    assert len(cases) == 4
    assert all(case.source == "synthetic" for case in cases)


async def test_passes_questions_per_chunk_to_the_llm(tmp_path: Path) -> None:
    llm = FakeLlm()
    await generate_dataset(
        config(tmp_path, num_chunks=1, questions_per_chunk=4),
        FakeSampler([chunk("p1", 0)]),
        llm,
    )
    assert llm.calls[0][2] == 4


async def test_rejects_records_without_query_id_placeholder_leak(tmp_path: Path) -> None:
    """No record may leave the generator with an unassigned (empty) query id."""
    corpus = [chunk("p1", 0), chunk("p2", 0)]
    cfg = config(tmp_path, num_chunks=2)

    records = await generate_dataset(cfg, FakeSampler(corpus), FakeLlm())

    assert all(r.query_id for r in records)
    for line in cfg.output_path.read_text(encoding="utf-8").strip().split("\n"):
        assert json.loads(line)["queryId"]


@pytest.mark.parametrize("space_key", [None, "OPS"])
async def test_forwards_space_key_to_the_sampler(tmp_path: Path, space_key: str | None) -> None:
    seen: list[str | None] = []

    class RecordingSampler(FakeSampler):
        def sample_chunks(
            self, n: int, rng: SeededRng, space_key: str | None = None
        ) -> list[SampledChunk]:
            seen.append(space_key)
            return super().sample_chunks(n, rng, space_key)

    await generate_dataset(
        config(tmp_path, num_chunks=1, space_key=space_key),
        RecordingSampler([chunk("p1", 0)]),
        FakeLlm(),
    )
    assert seen == [space_key]
