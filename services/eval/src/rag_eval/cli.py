import asyncio
import json
import sys
from contextlib import ExitStack, closing
from pathlib import Path
from typing import Annotated, Any

import psycopg
import typer

from rag_eval.compare import ComparisonRow, write_comparison
from rag_eval.config import Settings
from rag_eval.dataset.loader import DatasetNotFoundError, DatasetParseError, load_dataset
from rag_eval.embeddings.factory import create_embedding_client
from rag_eval.generator.anthropic_client import AnthropicClient
from rag_eval.generator.generate import GeneratorConfig, ProgressEvent, generate_dataset
from rag_eval.generator.sampler import PgVectorSampler
from rag_eval.rerank.base import Reranker
from rag_eval.rerank.factory import create_reranker
from rag_eval.runner.eval_runner import EvalRunner, RunnerContext, RunnerOptions
from rag_eval.runner.report import format_summary, write_report
from rag_eval.store.pgvector import PgVectorStore, RagProfile, load_profile

app = typer.Typer(
    name="rag-eval",
    help="RAG retrieval evaluation: golden datasets, IR metrics, reranking, A/B comparison.",
    no_args_is_help=True,
)


@app.command()
def generate(
    profile: Annotated[str, typer.Option(help="RAG profile to sample chunks from")] = "default",
    num_chunks: Annotated[int, typer.Option(min=1, help="Number of chunks to sample")] = 50,
    questions_per_chunk: Annotated[
        int, typer.Option(min=1, help="Questions generated per chunk")
    ] = 1,
    seed: Annotated[int, typer.Option(help="RNG seed for reproducible sampling")] = 42,
    out: Annotated[Path, typer.Option(help="Output JSONL path")] = Path("data/golden.jsonl"),
    space: Annotated[
        str | None, typer.Option(help="Restrict sampling to one Confluence space")
    ] = None,
    concurrency: Annotated[int, typer.Option(min=1, help="Parallel LLM calls")] = 4,
) -> None:
    """Generate a golden dataset by sampling chunks and asking an LLM for questions."""
    settings = Settings()
    if not settings.anthropic_api_key:
        _fail("Missing required env var: ANTHROPIC_API_KEY")

    with psycopg.connect(settings.database_url, autocommit=True) as conn:
        resolved = load_profile(conn, profile, settings)
        sampler = PgVectorSampler(conn, resolved.table_name)
        llm = AnthropicClient(api_key=settings.anthropic_api_key)

        config = GeneratorConfig(
            num_chunks=num_chunks,
            questions_per_chunk=questions_per_chunk,
            output_path=out.resolve(),
            seed=seed,
            concurrency=concurrency,
            space_key=space,
        )
        typer.echo(
            f"Generating questions for {num_chunks} chunks from table "
            f'"{resolved.table_name}" (seed={seed}, questions/chunk={questions_per_chunk})',
            err=True,
        )

        records = asyncio.run(_generate_and_close(config, sampler, llm))

    typer.echo(f"Done: {len(records)} records written to {config.output_path}", err=True)


async def _generate_and_close(config, sampler, llm):
    """Run generation and always release the client's connection pool in-loop."""
    try:
        return await generate_dataset(config, sampler, llm, on_progress=_report_progress)
    finally:
        await llm.aclose()


def _report_progress(event: ProgressEvent) -> None:
    tag = "generated" if event.status == "ok" else "skipped"
    reason = f" ({event.reason})" if event.reason else ""
    typer.echo(f"[{event.index}/{event.total}] {tag} {event.chunk_id}{reason}", err=True)


@app.command()
def run(
    dataset: Annotated[Path, typer.Option(help="Golden dataset JSONL path")] = Path(
        "data/golden.jsonl"
    ),
    profile: Annotated[str, typer.Option(help="RAG profile to evaluate")] = "default",
    reranker: Annotated[
        str | None, typer.Option(help="Reranker provider: cohere or voyage")
    ] = None,
    rerank_threshold: Annotated[
        float | None, typer.Option(help="Drop reranked results below this relevance score")
    ] = None,
) -> None:
    """Run the evaluation for one profile and write a JSON + Markdown report."""
    settings = Settings()
    cases = _load_cases(dataset)

    with psycopg.connect(settings.database_url, autocommit=True) as conn:
        report = _run_single(
            conn, settings, cases, str(dataset), profile, reranker, rerank_threshold
        )
        json_path, markdown_path = write_report(report, settings.eval_reports_dir)

    typer.echo(json.dumps(report, indent=2, ensure_ascii=False))
    typer.echo(f"\n{format_summary(report)}\n", err=True)
    typer.echo(f"Report written to: {json_path}", err=True)
    typer.echo(f"Summary written to: {markdown_path}", err=True)


@app.command()
def compare(
    dataset: Annotated[Path, typer.Option(help="Golden dataset JSONL path")] = Path(
        "data/golden.jsonl"
    ),
    profile: Annotated[
        list[str] | None, typer.Option(help="Profile to include (repeatable)")
    ] = None,
    reranker: Annotated[
        list[str] | None,
        typer.Option(help="Additionally evaluate each profile with this reranker (repeatable)"),
    ] = None,
    rerank_threshold: Annotated[
        float | None, typer.Option(help="Drop reranked results below this relevance score")
    ] = None,
) -> None:
    """A/B compare profiles (and optional rerankers) on the same dataset."""
    profiles = profile or ["default"]
    rerankers: list[str | None] = [None, *(reranker or [])]
    settings = Settings()
    cases = _load_cases(dataset)

    rows: list[ComparisonRow] = []
    generated_at = ""
    with psycopg.connect(settings.database_url, autocommit=True) as conn:
        for profile_name in profiles:
            for reranker_name in rerankers:
                report = _run_single(
                    conn,
                    settings,
                    cases,
                    str(dataset),
                    profile_name,
                    reranker_name,
                    rerank_threshold,
                )
                write_report(report, settings.eval_reports_dir)
                generated_at = report["generatedAt"]
                label = (
                    profile_name if reranker_name is None else (f"{profile_name} + {reranker_name}")
                )
                aggregated = report.get("rerankedAggregated", report["aggregated"])
                rows.append(ComparisonRow(label=label, aggregated=aggregated))
                typer.echo(f"Evaluated: {label}", err=True)

    path = write_comparison(
        rows, settings.k_values, settings.eval_reports_dir, str(dataset), generated_at
    )
    typer.echo(f"Comparison written to: {path}", err=True)


def _run_single(
    conn: psycopg.Connection,
    settings: Settings,
    cases: list[Any],
    dataset_path: str,
    profile_name: str,
    reranker_name: str | None,
    rerank_threshold: float | None,
) -> dict[str, Any]:
    resolved = load_profile(conn, profile_name, settings)

    # Embedding client and reranker each hold an httpx.Client; close them
    # deterministically instead of leaking one pair per evaluated combination.
    with ExitStack() as stack:
        embedding = stack.enter_context(closing(_build_embedding(settings, resolved)))
        reranker = _build_reranker(settings, reranker_name)
        if reranker is not None:
            stack.enter_context(closing(reranker))

        runner = EvalRunner(
            embedding=embedding,
            store=PgVectorStore(conn, resolved.table_name),
            options=RunnerOptions(
                k_values=settings.k_values,
                search_limit=settings.eval_search_limit,
                score_threshold=settings.eval_score_threshold,
                rerank_top_n=settings.rerank_top_n,
                rerank_threshold=(
                    rerank_threshold if rerank_threshold is not None else settings.rerank_threshold
                ),
            ),
            reranker=reranker,
        )
        context = RunnerContext(
            profile=resolved.profile_name,
            vector_table=resolved.table_name,
            embedding_provider=resolved.embedding_provider,
            dataset_path=dataset_path,
        )
        return runner.run(cases, context)


def _build_embedding(settings: Settings, resolved: RagProfile) -> Any:
    if not settings.embedding_api_key:
        _fail("Missing required env var: EMBEDDING_API_KEY")
    return create_embedding_client(
        provider=resolved.embedding_provider,
        api_key=settings.embedding_api_key,
        model=resolved.embedding_model,
        dimensions=resolved.embedding_dimensions,
    )


def _build_reranker(settings: Settings, override: str | None) -> Reranker | None:
    name = override if override is not None else settings.reranker
    if name is None or name == "none":
        return None
    if not settings.rerank_api_key:
        _fail("Missing required env var: RERANK_API_KEY")
    return create_reranker(
        provider=name,
        api_key=settings.rerank_api_key,
        model=settings.resolved_rerank_model(name),
    )


def _load_cases(dataset: Path) -> list[Any]:
    try:
        return load_dataset(dataset)
    except (DatasetNotFoundError, DatasetParseError) as error:
        typer.echo(str(error), err=True)
        raise typer.Exit(code=2) from error


def _fail(message: str) -> None:
    typer.echo(f"Error: {message}", err=True)
    raise typer.Exit(code=1)


if __name__ == "__main__":  # pragma: no cover
    sys.exit(app())
