from typing import Protocol, runtime_checkable


@runtime_checkable
class QueryEmbeddingClient(Protocol):
    """Embeds a search query into the same vector space as the indexed chunks."""

    model: str
    dimensions: int | None

    def embed_query(self, text: str) -> list[float]: ...

    def close(self) -> None: ...
