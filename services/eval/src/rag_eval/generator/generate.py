from collections.abc import Callable
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal, Protocol

from rag_eval.generator.anthropic_client import ChunkContext
from rag_eval.generator.concurrency import map_with_concurrency
from rag_eval.generator.jsonl_writer import write_jsonl
from rag_eval.generator.models import GeneratedQuestion, GoldenRecord, SampledChunk
from rag_eval.generator.rng import SeededRng


class ChunkSampler(Protocol):
    def sample_chunks(
        self, n: int, rng: SeededRng, space_key: str | None = None
    ) -> list[SampledChunk]: ...

    def get_chunks_by_page_id(self, page_id: str) -> list[SampledChunk]: ...


class QuestionGenerator(Protocol):
    model: str

    async def generate_questions(
        self, chunk_content: str, context: ChunkContext, count: int
    ) -> list[GeneratedQuestion]: ...


@dataclass(frozen=True)
class GeneratorConfig:
    num_chunks: int
    questions_per_chunk: int
    output_path: Path
    seed: int
    concurrency: int = 4
    space_key: str | None = None


@dataclass(frozen=True)
class ProgressEvent:
    index: int
    total: int
    chunk_id: str
    status: Literal["ok", "skipped"]
    reason: str | None = None


ProgressReporter = Callable[[ProgressEvent], None]


async def generate_dataset(
    config: GeneratorConfig,
    sampler: ChunkSampler,
    llm: QuestionGenerator,
    on_progress: ProgressReporter | None = None,
) -> list[GoldenRecord]:
    """Sample chunks, generate questions per chunk, write the golden JSONL.

    Sampling is deterministic per seed. LLM failures skip the affected chunk
    instead of aborting the run; query ids are assigned after the run so they
    stay dense and stable (q_001, q_002, ...).
    """
    rng = SeededRng(config.seed)
    chunks = sampler.sample_chunks(config.num_chunks, rng, space_key=config.space_key)

    if not chunks:
        write_jsonl(config.output_path, [])
        return []

    generated_at = datetime.now(UTC).isoformat()
    total = len(chunks)

    async def build(chunk: SampledChunk, index: int) -> list[GoldenRecord]:
        try:
            records = await _build_records_for_chunk(chunk, config, generated_at, sampler, llm)
        except Exception as error:
            if on_progress:
                on_progress(
                    ProgressEvent(
                        index=index + 1,
                        total=total,
                        chunk_id=chunk.chunk_id,
                        status="skipped",
                        reason=str(error),
                    )
                )
            raise
        if on_progress:
            on_progress(
                ProgressEvent(index=index + 1, total=total, chunk_id=chunk.chunk_id, status="ok")
            )
        return records

    results = await map_with_concurrency(chunks, config.concurrency, build)

    records: list[GoldenRecord] = []
    for per_chunk in results:
        if per_chunk is None:
            continue
        for record in per_chunk:
            records.append(replace(record, query_id=format_query_id(len(records) + 1)))

    write_jsonl(config.output_path, records)
    return records


async def _build_records_for_chunk(
    chunk: SampledChunk,
    config: GeneratorConfig,
    generated_at: str,
    sampler: ChunkSampler,
    llm: QuestionGenerator,
) -> list[GoldenRecord]:
    questions = await llm.generate_questions(
        chunk.content,
        ChunkContext(title=chunk.metadata.title, header_path=chunk.metadata.header_path),
        config.questions_per_chunk,
    )

    relevant_chunk_ids = _collect_relevant_chunk_ids(chunk, sampler)

    return [
        GoldenRecord(
            query_id="",  # assigned after all chunks finished
            query=question.question,
            relevant_chunk_ids=relevant_chunk_ids,
            source="synthetic",
            metadata={
                "sourcePageId": chunk.page_id,
                "sourcePageTitle": chunk.metadata.title,
                "sourceSpaceKey": chunk.metadata.space_key,
                "rationale": question.rationale,
                "generatedBy": llm.model,
                "generatedAt": generated_at,
            },
        )
        for question in questions
    ]


def _collect_relevant_chunk_ids(source: SampledChunk, sampler: ChunkSampler) -> tuple[str, ...]:
    """Source chunk first, then its same-page neighbours.

    Heuristic: chunks of the same page answer the same question. Good enough
    for a synthetic eval set and avoids a second LLM call per neighbour.
    """
    same_page = sampler.get_chunks_by_page_id(source.page_id)
    neighbours = [c.chunk_id for c in same_page if c.chunk_id != source.chunk_id]
    return (source.chunk_id, *neighbours)


def format_query_id(n: int) -> str:
    return f"q_{n:03d}"
