from collections.abc import Sequence
from typing import Self

import httpx

from rag_eval.http_retry import post_with_retry
from rag_eval.rerank.base import RerankCandidate, RerankedResult


class CohereReranker:
    provider = "cohere"

    def __init__(
        self,
        api_key: str,
        model: str,
        base_url: str = "https://api.cohere.com/v2",
        client: httpx.Client | None = None,
    ) -> None:
        self._api_key = api_key
        self.model = model
        self._base_url = base_url
        self._client = client or httpx.Client(timeout=30.0)

    def rerank(
        self, query: str, candidates: Sequence[RerankCandidate], top_n: int
    ) -> list[RerankedResult]:
        if not candidates:
            return []
        data = post_with_retry(
            self._client,
            f"{self._base_url}/rerank",
            service="Cohere rerank",
            json={
                "model": self.model,
                "query": query,
                "documents": [content for _, content in candidates],
                "top_n": top_n,
            },
            headers={"Authorization": f"Bearer {self._api_key}"},
        )
        return [
            (candidates[result["index"]][0], float(result["relevance_score"]))
            for result in data["results"]
        ]

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> Self:
        return self

    def __exit__(self, *exc_info: object) -> None:
        self.close()
