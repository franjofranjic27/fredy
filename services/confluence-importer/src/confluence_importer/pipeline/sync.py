"""Incremental Confluence sync: CQL lastModified updates + deletion detection.

Deleted pages are detected per configured space by diffing the page ids stored
for that space against the ids currently live in Confluence. Pages of spaces
that are no longer configured and local-file ids are never touched.
"""

import logging
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

from confluence_importer.chunking.base import get_chunker
from confluence_importer.confluence.client import ConfluenceClient
from confluence_importer.confluence.models import ConfluencePage
from confluence_importer.embeddings.base import EmbeddingProvider
from confluence_importer.media.attachments import AttachmentIngestor
from confluence_importer.profiles import RagProfile
from confluence_importer.store.pgvector import PgVectorStore

logger = logging.getLogger(__name__)

_LOCAL_PAGE_ID_PREFIX = "local_"


@dataclass
class SyncResult:
    pages_updated: int = 0
    pages_deleted: int = 0
    chunks_created: int = 0
    sync_time: datetime = field(default_factory=lambda: datetime.now(UTC))


def sync_confluence(
    confluence: ConfluenceClient,
    embedding: EmbeddingProvider,
    store: PgVectorStore,
    profile: RagProfile,
    *,
    spaces: list[str],
    include_labels: list[str] | None = None,
    exclude_labels: list[str] | None = None,
    last_sync_time: datetime | None = None,
    attachment_ingestor: AttachmentIngestor | None = None,
) -> SyncResult:
    if last_sync_time is None:
        last_sync_time = datetime.now(UTC) - timedelta(hours=24)

    result = SyncResult(sync_time=datetime.now(UTC))

    # Register the profile so sync-only deployments also appear in rag_profiles.
    store.upsert_profile(profile)

    for space_key in spaces:
        logger.info("Syncing space %s", space_key)
        modified_pages = confluence.get_modified_pages(space_key, last_sync_time)
        logger.info("Found %d modified pages in %s", len(modified_pages), space_key)

        for page in modified_pages:
            try:
                _sync_page(
                    page,
                    confluence,
                    embedding,
                    store,
                    profile,
                    result,
                    include_labels=include_labels,
                    exclude_labels=exclude_labels,
                    attachment_ingestor=attachment_ingestor,
                )
            except Exception as error:
                logger.error("Failed to sync page %s (%s): %s", page.id, page.title, error)

    _delete_stale_pages(confluence, store, spaces, result)

    return result


def _sync_page(
    page: ConfluencePage,
    confluence: ConfluenceClient,
    embedding: EmbeddingProvider,
    store: PgVectorStore,
    profile: RagProfile,
    result: SyncResult,
    *,
    include_labels: list[str] | None,
    exclude_labels: list[str] | None,
    attachment_ingestor: AttachmentIngestor | None,
) -> None:
    if not confluence.should_include_page(
        page, include_labels=include_labels, exclude_labels=exclude_labels
    ):
        logger.info("Deleting page (excluded by label): %s (%s)", page.title, page.id)
        store.delete_page_chunks(page.id)
        result.pages_deleted += 1
        return

    logger.info("Updating page: %s", page.title)
    metadata = confluence.extract_metadata(page)
    chunker = get_chunker(profile.chunker)
    chunks = chunker.chunk(page.body.storage.value, metadata, profile.chunker_params)

    # Embed first, then swap atomically: an embedding failure must not leave
    # the page without its previous chunks.
    embeddings = embedding.embed_texts([chunk.content for chunk in chunks]) if chunks else []
    store.replace_page_chunks(page.id, chunks, embeddings)

    if attachment_ingestor is not None:
        attachment_ingestor.ingest_page_attachments(metadata)

    result.pages_updated += 1
    result.chunks_created += len(chunks)


def _delete_stale_pages(
    confluence: ConfluenceClient,
    store: PgVectorStore,
    spaces: list[str],
    result: SyncResult,
) -> None:
    """Remove chunks of pages that no longer exist in their configured space.

    Deletion is scoped per synced space: pages stored for spaces that are no
    longer configured are left untouched, and local-file pages (``local_*``
    ids) are always exempt.
    """
    try:
        for space_key in spaces:
            live_ids = set(confluence.get_all_page_ids_in_space(space_key))
            stored_ids = [
                page_id
                for page_id in store.list_stored_page_ids(space_key=space_key)
                if not page_id.startswith(_LOCAL_PAGE_ID_PREFIX)
            ]

            for page_id in stored_ids:
                if page_id not in live_ids:
                    logger.info("Deleting stale page: %s", page_id)
                    store.delete_page_chunks(page_id)
                    result.pages_deleted += 1
    except Exception as error:
        logger.error("Deletion detection failed: %s", error)
