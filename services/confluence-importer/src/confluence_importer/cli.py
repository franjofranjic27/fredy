"""Command-line interface: ingest, sync, profiles, run (scheduler daemon)."""

import logging
from dataclasses import dataclass

import typer

from confluence_importer.config import Config, load_config
from confluence_importer.confluence.client import ConfluenceClient
from confluence_importer.embeddings.base import EmbeddingProvider, create_embedding_provider
from confluence_importer.logging import configure_logging
from confluence_importer.media.attachments import AnthropicCaptioner, AttachmentIngestor
from confluence_importer.pipeline.ingest import ingest_confluence
from confluence_importer.pipeline.local_files import LocalFileClient, ingest_local_files
from confluence_importer.pipeline.sync import sync_confluence
from confluence_importer.profiles import RagProfile, get_profile, load_profiles
from confluence_importer.scheduler import run_scheduler
from confluence_importer.store.pgvector import PgVectorStore

logger = logging.getLogger(__name__)

app = typer.Typer(help="Confluence → pgvector RAG importer with swappable profiles.")
profiles_app = typer.Typer(help="Manage RAG profiles.")
app.add_typer(profiles_app, name="profiles")

_PROFILE_OPTION = typer.Option("default", "--profile", help="RAG profile name.")


@dataclass(frozen=True)
class _Runtime:
    config: Config
    profile: RagProfile
    confluence: ConfluenceClient | None
    embedding: EmbeddingProvider
    store: PgVectorStore
    attachment_ingestor: AttachmentIngestor | None


def _build_runtime(profile_name: str) -> _Runtime:
    config = load_config()
    configure_logging(config.log_level)
    profile = get_profile(config, profile_name)

    confluence: ConfluenceClient | None = None
    if config.confluence:
        confluence = ConfluenceClient(
            base_url=config.confluence.base_url,
            username=config.confluence.username,
            api_token=config.confluence.api_token,
        )

    embedding = create_embedding_provider(
        profile.embedding_provider,
        api_key=profile.resolve_api_key(config.embedding.api_key),
        model=profile.embedding_model,
        dimensions=profile.embedding_dimensions,
    )

    store = PgVectorStore(
        database_url=config.database.url,
        table_name=profile.table_name,
        vector_size=profile.embedding_dimensions,
    )

    attachment_ingestor: AttachmentIngestor | None = None
    if config.media.enabled and confluence is not None:
        captioner: AnthropicCaptioner | None = None
        if config.media.caption_enabled and config.media.anthropic_api_key:
            captioner = AnthropicCaptioner(config.media.anthropic_api_key)
        attachment_ingestor = AttachmentIngestor(
            confluence,
            store,
            max_bytes=config.media.max_bytes,
            captioner=captioner,
            embedding=embedding if captioner else None,
        )

    return _Runtime(
        config=config,
        profile=profile,
        confluence=confluence,
        embedding=embedding,
        store=store,
        attachment_ingestor=attachment_ingestor,
    )


def _run_ingest(runtime: _Runtime) -> None:
    config = runtime.config

    if runtime.confluence and config.confluence:
        result = ingest_confluence(
            runtime.confluence,
            runtime.embedding,
            runtime.store,
            runtime.profile,
            spaces=config.confluence.spaces,
            include_labels=config.confluence.include_labels,
            exclude_labels=config.confluence.exclude_labels,
            attachment_ingestor=runtime.attachment_ingestor,
        )
        logger.info(
            "Confluence ingestion complete: pages=%d skipped=%d chunks=%d attachments=%d errors=%d",
            result.pages_processed,
            result.pages_skipped,
            result.chunks_created,
            result.attachments_stored,
            len(result.errors),
        )
        for page_id, error in result.errors:
            logger.error("Page ingestion error (%s): %s", page_id, error)
    else:
        logger.warning("Confluence not configured — set CONFLUENCE_BASE_URL to enable")

    if config.local_files.enabled:
        local_client = LocalFileClient(config.local_files.directory, config.local_files.extensions)
        local_result = ingest_local_files(
            local_client, runtime.embedding, runtime.store, runtime.profile
        )
        logger.info(
            "Local file ingestion complete: files=%d chunks=%d errors=%d",
            local_result.files_processed,
            local_result.chunks_created,
            len(local_result.errors),
        )


def _run_sync(runtime: _Runtime) -> None:
    if not runtime.confluence or not runtime.config.confluence:
        logger.error("Confluence not configured — sync requires CONFLUENCE_BASE_URL")
        raise typer.Exit(code=1)

    result = sync_confluence(
        runtime.confluence,
        runtime.embedding,
        runtime.store,
        runtime.profile,
        spaces=runtime.config.confluence.spaces,
        include_labels=runtime.config.confluence.include_labels,
        exclude_labels=runtime.config.confluence.exclude_labels,
        attachment_ingestor=runtime.attachment_ingestor,
    )
    logger.info(
        "Sync complete: updated=%d deleted=%d chunks=%d",
        result.pages_updated,
        result.pages_deleted,
        result.chunks_created,
    )


@app.command()
def ingest(
    profile: str = _PROFILE_OPTION,
    full: bool = typer.Option(
        False, "--full", help="Truncate the profile table before ingesting (clean rebuild)."
    ),
) -> None:
    """Run a full ingestion of all configured sources into the profile table."""
    runtime = _build_runtime(profile)
    runtime.store.init_schema()
    if full:
        logger.info("Full rebuild requested — truncating table %s", runtime.profile.table_name)
        runtime.store.truncate()
    _run_ingest(runtime)


@app.command()
def sync(profile: str = _PROFILE_OPTION) -> None:
    """Sync recently modified Confluence pages and remove deleted ones."""
    runtime = _build_runtime(profile)
    runtime.store.init_schema()
    _run_sync(runtime)


@profiles_app.command("list")
def profiles_list() -> None:
    """List all configured RAG profiles."""
    config = load_config()
    configure_logging(config.log_level)
    for name, prof in sorted(load_profiles(config).items()):
        typer.echo(
            f"{name}: chunker={prof.chunker} provider={prof.embedding_provider} "
            f"model={prof.embedding_model} dims={prof.embedding_dimensions} "
            f"table={prof.table_name} params={prof.chunker_params}"
        )


@app.command()
def run(profile: str = _PROFILE_OPTION) -> None:
    """Scheduler mode (Docker default): optional full ingest on start, then cron sync."""
    runtime = _build_runtime(profile)
    runtime.store.init_schema()

    if runtime.config.sync.full_sync_on_start:
        logger.info("Running initial full ingestion (SYNC_FULL_ON_START)")
        _run_ingest(runtime)

    if not runtime.confluence:
        logger.warning("Confluence not configured — cron sync disabled, idle daemon")
        run_scheduler(runtime.config.sync.cron_schedule, lambda: None)
        return

    run_scheduler(runtime.config.sync.cron_schedule, lambda: _run_sync(runtime))


if __name__ == "__main__":
    app()
