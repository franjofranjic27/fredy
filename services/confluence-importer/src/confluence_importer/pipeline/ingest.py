"""Full Confluence ingestion for one RAG profile.

Pages are buffered whole so embedding calls stay batched across pages while
each page's chunks are still swapped atomically (embed first, then
``replace_page_chunks`` in one transaction).
"""

import logging
from dataclasses import dataclass, field

from confluence_importer.chunking.base import get_chunker
from confluence_importer.confluence.client import ConfluenceClient
from confluence_importer.confluence.models import ConfluencePage
from confluence_importer.embeddings.base import EmbeddingProvider
from confluence_importer.media.attachments import AttachmentIngestor
from confluence_importer.pipeline.chunk_batch import PageChunks, flush_page_buffer
from confluence_importer.profiles import RagProfile
from confluence_importer.store.pgvector import PgVectorStore

logger = logging.getLogger(__name__)

_DEFAULT_BATCH_SIZE = 10


@dataclass
class IngestResult:
    pages_processed: int = 0
    pages_skipped: int = 0
    chunks_created: int = 0
    attachments_stored: int = 0
    errors: list[tuple[str, str]] = field(default_factory=list)  # (page_id, error)


def ingest_confluence(
    confluence: ConfluenceClient,
    embedding: EmbeddingProvider,
    store: PgVectorStore,
    profile: RagProfile,
    *,
    spaces: list[str],
    include_labels: list[str] | None = None,
    exclude_labels: list[str] | None = None,
    batch_size: int = _DEFAULT_BATCH_SIZE,
    attachment_ingestor: AttachmentIngestor | None = None,
) -> IngestResult:
    result = IngestResult()

    store.init_schema()
    store.upsert_profile(profile)
    if attachment_ingestor is not None:
        store.init_attachments_schema()

    for space_key in spaces:
        logger.info("Processing space %s", space_key)
        buffer: list[PageChunks] = []

        for page in confluence.get_all_pages_in_space(space_key):
            try:
                _process_page(
                    page,
                    confluence,
                    embedding,
                    store,
                    profile,
                    buffer,
                    result,
                    include_labels=include_labels,
                    exclude_labels=exclude_labels,
                    batch_size=batch_size,
                    attachment_ingestor=attachment_ingestor,
                )
            except Exception as error:
                logger.error("Failed to process page %s (%s): %s", page.id, page.title, error)
                result.errors.append((page.id, str(error)))

        flush_page_buffer(buffer, embedding, store)

    return result


def _process_page(
    page: ConfluencePage,
    confluence: ConfluenceClient,
    embedding: EmbeddingProvider,
    store: PgVectorStore,
    profile: RagProfile,
    buffer: list[PageChunks],
    result: IngestResult,
    *,
    include_labels: list[str] | None,
    exclude_labels: list[str] | None,
    batch_size: int,
    attachment_ingestor: AttachmentIngestor | None,
) -> None:
    if not confluence.should_include_page(
        page, include_labels=include_labels, exclude_labels=exclude_labels
    ):
        logger.debug("Skipping page (label filter): %s", page.title)
        result.pages_skipped += 1
        return

    logger.info("Processing page: %s", page.title)
    metadata = confluence.extract_metadata(page)
    chunker = get_chunker(profile.chunker)
    chunks = chunker.chunk(page.body.storage.value, metadata, profile.chunker_params)
    logger.debug("Chunks created for %s: %d", page.title, len(chunks))

    buffer.append((page.id, chunks))
    if sum(len(page_chunks) for _, page_chunks in buffer) >= batch_size:
        flush_page_buffer(buffer, embedding, store)

    result.pages_processed += 1
    result.chunks_created += len(chunks)

    if attachment_ingestor is not None:
        attachment_result = attachment_ingestor.ingest_page_attachments(metadata)
        result.attachments_stored += attachment_result.attachments_stored
