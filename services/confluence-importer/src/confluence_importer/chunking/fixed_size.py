"""Fixed-size token-window chunking strategy (tiktoken cl100k_base windows with overlap)."""

from collections.abc import Mapping
from typing import Any

from confluence_importer.chunking.base import (
    Chunk,
    build_chunk_metadata,
    build_context_prefix,
)
from confluence_importer.chunking.html_to_text import html_to_text
from confluence_importer.chunking.tokenizer import get_encoding
from confluence_importer.confluence.models import PageMetadata


class FixedSizeChunker:
    name = "fixed_size"

    def chunk(self, html: str, page: PageMetadata, params: Mapping[str, Any]) -> list[Chunk]:
        max_tokens = int(params.get("max_tokens", 800))
        overlap_tokens = int(params.get("overlap_tokens", 100))
        if overlap_tokens >= max_tokens:
            raise ValueError("overlap_tokens must be smaller than max_tokens")

        text = html_to_text(html).strip()
        if not text:
            return []

        encoding = get_encoding()
        tokens = encoding.encode(text)
        step = max_tokens - overlap_tokens

        windows: list[str] = []
        for start in range(0, len(tokens), step):
            window = tokens[start : start + max_tokens]
            windows.append(encoding.decode(window).strip())
            if start + max_tokens >= len(tokens):
                break

        prefix = build_context_prefix(page, [])
        total = len(windows)
        return [
            Chunk(
                id=f"{page.page_id}_{index}",
                content=prefix + window,
                metadata=build_chunk_metadata(
                    page,
                    chunk_index=index,
                    total_chunks=total,
                    header_path=[],
                    content_type="text",
                ),
            )
            for index, window in enumerate(windows)
        ]
