from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class SampledChunkMetadata:
    title: str
    space_key: str
    header_path: tuple[str, ...]
    chunk_index: int
    total_chunks: int
    space_name: str | None = None


@dataclass(frozen=True)
class SampledChunk:
    chunk_id: str
    page_id: str
    content: str
    metadata: SampledChunkMetadata


@dataclass(frozen=True)
class GeneratedQuestion:
    question: str
    rationale: str


@dataclass(frozen=True)
class GoldenRecord:
    """One JSONL line of the golden dataset. Serialized with camelCase keys."""

    query_id: str
    query: str
    relevant_chunk_ids: tuple[str, ...]
    source: str = "synthetic"
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_json_dict(self) -> dict[str, Any]:
        return {
            "queryId": self.query_id,
            "query": self.query,
            "relevantChunkIds": list(self.relevant_chunk_ids),
            "source": self.source,
            "metadata": self.metadata,
        }
