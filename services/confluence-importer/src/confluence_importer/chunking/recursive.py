"""Recursive character chunking via langchain-text-splitters over the shared html→text output."""

from collections.abc import Mapping
from typing import Any

from langchain_text_splitters import RecursiveCharacterTextSplitter

from confluence_importer.chunking.base import (
    Chunk,
    build_chunk_metadata,
    build_context_prefix,
)
from confluence_importer.chunking.html_to_text import html_to_text
from confluence_importer.confluence.models import PageMetadata


class RecursiveChunker:
    name = "recursive"

    def chunk(self, html: str, page: PageMetadata, params: Mapping[str, Any]) -> list[Chunk]:
        chunk_size = int(params.get("chunk_size", 2000))
        chunk_overlap = int(params.get("chunk_overlap", 200))

        text = html_to_text(html).strip()
        if not text:
            return []

        splitter = RecursiveCharacterTextSplitter(
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap,
        )
        pieces = [piece for piece in splitter.split_text(text) if piece.strip()]
        if not pieces:
            return []

        prefix = build_context_prefix(page, [])
        total = len(pieces)
        return [
            Chunk(
                id=f"{page.page_id}_{index}",
                content=prefix + piece.strip(),
                metadata=build_chunk_metadata(
                    page,
                    chunk_index=index,
                    total_chunks=total,
                    header_path=[],
                    content_type="text",
                ),
            )
            for index, piece in enumerate(pieces)
        ]
