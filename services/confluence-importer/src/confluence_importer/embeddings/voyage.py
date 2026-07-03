"""Voyage AI embeddings via the REST API (no SDK dependency)."""

import httpx

from confluence_importer.embeddings.base import EmbeddingApiError, batched, validate_dimensions
from confluence_importer.retry import with_retry

_BASE_URL = "https://api.voyageai.com/v1"
_MAX_BATCH = 128


class VoyageEmbedding:
    def __init__(
        self,
        *,
        api_key: str,
        model: str,
        dimensions: int = 1024,
        http_client: httpx.Client | None = None,
    ) -> None:
        self.model = model or "voyage-2"
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
                json={"model": self.model, "input": texts, "input_type": "document"},
            )
            if response.status_code >= 400:
                raise EmbeddingApiError("Voyage", response.status_code, response.text)
            data = response.json()["data"]
            # The API is not guaranteed to preserve input order; restore it via
            # the per-item index when the response carries one.
            if all("index" in item for item in data):
                data = sorted(data, key=lambda item: item["index"])
            embeddings = [item["embedding"] for item in data]
            return validate_dimensions("Voyage", self.model, self.dimensions, embeddings)

        return with_retry(do_request)
