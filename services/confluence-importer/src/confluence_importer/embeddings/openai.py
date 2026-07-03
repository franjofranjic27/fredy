"""OpenAI embeddings via the REST API (no SDK dependency)."""

import httpx

from confluence_importer.embeddings.base import EmbeddingApiError, batched, validate_dimensions
from confluence_importer.retry import with_retry

_BASE_URL = "https://api.openai.com/v1"
_MAX_BATCH = 100


class OpenAIEmbedding:
    def __init__(
        self,
        *,
        api_key: str,
        model: str,
        dimensions: int = 1536,
        http_client: httpx.Client | None = None,
    ) -> None:
        self.model = model
        self.dimensions = dimensions
        self._http = http_client or httpx.Client(
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=60.0,
        )

    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        results: list[list[float]] = []
        for batch in batched(texts, _MAX_BATCH):
            results.extend(self._embed_batch(batch))
        return results

    def embed_query(self, text: str) -> list[float]:
        return self.embed_texts([text])[0]

    def _embed_batch(self, texts: list[str]) -> list[list[float]]:
        def do_request() -> list[list[float]]:
            response = self._http.post(
                f"{_BASE_URL}/embeddings",
                json={"model": self.model, "input": texts, "dimensions": self.dimensions},
            )
            if response.status_code >= 400:
                raise EmbeddingApiError("OpenAI", response.status_code, response.text)
            data = sorted(response.json()["data"], key=lambda item: item["index"])
            embeddings = [item["embedding"] for item in data]
            return validate_dimensions("OpenAI", self.model, self.dimensions, embeddings)

        return with_retry(do_request)
