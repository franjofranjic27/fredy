"""Embedding provider protocol and factory."""

from typing import Protocol, runtime_checkable

import httpx


@runtime_checkable
class EmbeddingProvider(Protocol):
    """A batch embedding provider for documents and queries."""

    model: str
    dimensions: int

    def embed_texts(self, texts: list[str]) -> list[list[float]]: ...

    def embed_query(self, text: str) -> list[float]: ...


class EmbeddingApiError(Exception):
    def __init__(self, provider: str, status_code: int, body: str) -> None:
        super().__init__(f"{provider} embedding failed ({status_code}): {body}")
        self.status_code = status_code


def batched[T](items: list[T], size: int) -> list[list[T]]:
    return [items[i : i + size] for i in range(0, len(items), size)]


def validate_dimensions(
    provider: str, model: str, expected: int, embeddings: list[list[float]]
) -> list[list[float]]:
    """Fail fast when the API returns vectors that don't match the configured dimensions.

    A mismatch would otherwise only surface as an opaque pgvector insert error
    (or, worse, silently corrupt a table created with the wrong vector size).
    """
    for embedding in embeddings:
        if len(embedding) != expected:
            raise ValueError(
                f"{provider} model {model!r} returned a {len(embedding)}-dimensional "
                f"embedding, but {expected} dimensions are configured"
            )
    return embeddings


def create_embedding_provider(
    provider: str,
    *,
    api_key: str,
    model: str,
    dimensions: int,
    http_client: httpx.Client | None = None,
) -> EmbeddingProvider:
    from confluence_importer.embeddings.cohere import CohereEmbedding
    from confluence_importer.embeddings.openai import OpenAIEmbedding
    from confluence_importer.embeddings.voyage import VoyageEmbedding

    match provider:
        case "openai":
            return OpenAIEmbedding(
                api_key=api_key, model=model, dimensions=dimensions, http_client=http_client
            )
        case "voyage":
            return VoyageEmbedding(
                api_key=api_key, model=model, dimensions=dimensions, http_client=http_client
            )
        case "cohere":
            return CohereEmbedding(
                api_key=api_key, model=model, dimensions=dimensions, http_client=http_client
            )
        case _:
            raise ValueError(f"Unknown embedding provider: {provider}")
