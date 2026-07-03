"""Chunker protocol and registry — the extension point for RAG chunking experiments."""

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any, Protocol, runtime_checkable

from confluence_importer.confluence.models import PageMetadata


@dataclass(frozen=True)
class Chunk:
    """One embeddable text segment. ``metadata`` uses camelCase keys (JSONB parity)."""

    id: str
    content: str
    metadata: dict[str, Any] = field(default_factory=dict)


@runtime_checkable
class Chunker(Protocol):
    """A chunking strategy. Implementations must be stateless and parametrized per call."""

    name: str

    def chunk(self, html: str, page: PageMetadata, params: Mapping[str, Any]) -> list[Chunk]: ...


_REGISTRY: dict[str, Chunker] = {}


def register_chunker(chunker: Chunker) -> None:
    _REGISTRY[chunker.name] = chunker


def get_chunker(name: str) -> Chunker:
    try:
        return _REGISTRY[name]
    except KeyError:
        available = ", ".join(sorted(_REGISTRY)) or "(none)"
        raise ValueError(f"Unknown chunker: {name!r}. Available: {available}") from None


def build_context_prefix(page: PageMetadata, header_path: list[str]) -> str:
    """Contextual prefix prepended to every chunk (identical to the TS chunker)."""
    parts = [f"Page: {page.title}"]
    if page.ancestors:
        parts.append(f"Path: {' > '.join(page.ancestors)}")
    if header_path:
        parts.append(f"Section: {' > '.join(header_path)}")
    return "\n".join(parts) + "\n\n"


def build_chunk_metadata(
    page: PageMetadata,
    *,
    chunk_index: int,
    total_chunks: int,
    header_path: list[str],
    content_type: str,
) -> dict[str, Any]:
    metadata = page.to_metadata_dict()
    metadata.update(
        chunkIndex=chunk_index,
        totalChunks=total_chunks,
        headerPath=header_path,
        contentType=content_type,
    )
    return metadata
