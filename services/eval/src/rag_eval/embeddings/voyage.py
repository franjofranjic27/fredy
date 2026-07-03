from typing import Self

import httpx

from rag_eval.http_retry import post_with_retry

DEFAULT_MODEL = "voyage-2"
DEFAULT_DIMENSIONS = 1024


class VoyageQueryEmbedding:
    """Voyage query embedding. Uses ``input_type: "query"`` so the vector is
    optimized for retrieval against document-embedded chunks."""

    def __init__(
        self,
        api_key: str,
        model: str,
        dimensions: int | None = None,
        base_url: str = "https://api.voyageai.com/v1",
        client: httpx.Client | None = None,
    ) -> None:
        self._api_key = api_key
        self.model = model or DEFAULT_MODEL
        self.dimensions: int | None = dimensions if dimensions is not None else DEFAULT_DIMENSIONS
        self._base_url = base_url
        self._client = client or httpx.Client(timeout=30.0)

    def embed_query(self, text: str) -> list[float]:
        data = post_with_retry(
            self._client,
            f"{self._base_url}/embeddings",
            service="Voyage embedding",
            json={"model": self.model, "input": [text], "input_type": "query"},
            headers={"Authorization": f"Bearer {self._api_key}"},
        )
        return data["data"][0]["embedding"]

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> Self:
        return self

    def __exit__(self, *exc_info: object) -> None:
        self.close()
