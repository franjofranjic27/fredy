"""Page-buffer flushing shared by the ingest and local-file pipelines.

Pages are buffered whole so embedding calls stay batched across pages while
each page's chunks are still swapped atomically (embed first, then
``replace_page_chunks`` in one transaction).
"""

import logging

from confluence_importer.chunking.base import Chunk
from confluence_importer.embeddings.base import EmbeddingProvider
from confluence_importer.store.pgvector import PgVectorStore

logger = logging.getLogger(__name__)

PageChunks = tuple[str, list[Chunk]]


def flush_page_buffer(
    buffer: list[PageChunks],
    embedding: EmbeddingProvider,
    store: PgVectorStore,
) -> None:
    """Embed all buffered chunks in one batch, then replace each page atomically."""
    if not buffer:
        return

    pages = list(buffer)
    buffer.clear()

    texts = [chunk.content for _, chunks in pages for chunk in chunks]
    logger.debug("Embedding page buffer (pages=%d, chunks=%d)", len(pages), len(texts))
    embeddings = embedding.embed_texts(texts) if texts else []

    offset = 0
    for page_id, chunks in pages:
        store.replace_page_chunks(page_id, chunks, embeddings[offset : offset + len(chunks)])
        offset += len(chunks)
