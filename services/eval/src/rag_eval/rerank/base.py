from collections.abc import Sequence
from typing import Protocol, runtime_checkable

RerankCandidate = tuple[str, str]
"""(chunk_id, content) pair fed into the reranker."""

RerankedResult = tuple[str, float]
"""(chunk_id, relevance_score) pair, ordered by relevance descending."""


@runtime_checkable
class Reranker(Protocol):
    """Second-stage ranker over the candidates returned by vector search."""

    provider: str
    model: str

    def rerank(
        self, query: str, candidates: Sequence[RerankCandidate], top_n: int
    ) -> list[RerankedResult]: ...

    def close(self) -> None: ...
