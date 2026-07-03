from typing import Self

import httpx

from rag_eval.http_retry import post_with_retry

DEFAULT_DIMENSIONS = 1536


class OpenAIQueryEmbedding:
    def __init__(
        self,
        api_key: str,
        model: str,
        dimensions: int | None = None,
        base_url: str = "https://api.openai.com/v1",
        client: httpx.Client | None = None,
    ) -> None:
        self._api_key = api_key
        self.model = model
        self.dimensions: int | None = dimensions if dimensions is not None else DEFAULT_DIMENSIONS
        self._base_url = base_url
        self._client = client or httpx.Client(timeout=30.0)

    def embed_query(self, text: str) -> list[float]:
        data = post_with_retry(
            self._client,
            f"{self._base_url}/embeddings",
            service="OpenAI embedding",
            json={"model": self.model, "input": [text], "dimensions": self.dimensions},
            headers={"Authorization": f"Bearer {self._api_key}"},
        )
        return data["data"][0]["embedding"]

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> Self:
        return self

    def __exit__(self, *exc_info: object) -> None:
        self.close()
