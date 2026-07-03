import json

import httpx
import pytest
from pytest_httpx import HTTPXMock

from rag_eval.rerank.cohere import CohereReranker
from rag_eval.rerank.factory import create_reranker
from rag_eval.rerank.voyage import VoyageReranker

CANDIDATES = [("c1", "first content"), ("c2", "second content"), ("c3", "third content")]


class TestCohereReranker:
    def test_reranks_and_maps_indexes_to_chunk_ids(self, httpx_mock: HTTPXMock) -> None:
        httpx_mock.add_response(
            url="https://api.cohere.com/v2/rerank",
            json={
                "results": [
                    {"index": 2, "relevance_score": 0.98},
                    {"index": 0, "relevance_score": 0.41},
                ]
            },
        )
        reranker = CohereReranker(api_key="k", model="rerank-v3.5")

        result = reranker.rerank("query", CANDIDATES, top_n=2)

        assert result == [("c3", 0.98), ("c1", 0.41)]
        body = json.loads(httpx_mock.get_request().content)
        assert body == {
            "model": "rerank-v3.5",
            "query": "query",
            "documents": ["first content", "second content", "third content"],
            "top_n": 2,
        }

    def test_returns_empty_for_no_candidates(self, httpx_mock: HTTPXMock) -> None:
        reranker = CohereReranker(api_key="k", model="rerank-v3.5")
        assert reranker.rerank("query", [], top_n=5) == []
        assert httpx_mock.get_requests() == []


class TestVoyageReranker:
    def test_reranks_via_the_v1_endpoint(self, httpx_mock: HTTPXMock) -> None:
        httpx_mock.add_response(
            url="https://api.voyageai.com/v1/rerank",
            json={
                "data": [
                    {"index": 1, "relevance_score": 0.9},
                    {"index": 2, "relevance_score": 0.2},
                ]
            },
        )
        reranker = VoyageReranker(api_key="k", model="rerank-2.5")

        result = reranker.rerank("query", CANDIDATES, top_n=2)

        assert result == [("c2", 0.9), ("c3", 0.2)]
        body = json.loads(httpx_mock.get_request().content)
        assert body["top_k"] == 2
        assert body["model"] == "rerank-2.5"

    def test_returns_empty_for_no_candidates(self, httpx_mock: HTTPXMock) -> None:
        reranker = VoyageReranker(api_key="k", model="rerank-2.5")
        assert reranker.rerank("query", [], top_n=5) == []
        assert httpx_mock.get_requests() == []


class TestClose:
    @pytest.mark.parametrize("reranker_cls", [CohereReranker, VoyageReranker])
    def test_close_shuts_down_the_http_client(self, reranker_cls: type) -> None:
        http_client = httpx.Client()
        reranker = reranker_cls(api_key="k", model="m", client=http_client)

        reranker.close()

        assert http_client.is_closed

    @pytest.mark.parametrize("reranker_cls", [CohereReranker, VoyageReranker])
    def test_usable_as_context_manager(self, reranker_cls: type) -> None:
        http_client = httpx.Client()
        with reranker_cls(api_key="k", model="m", client=http_client) as reranker:
            assert reranker.model == "m"
        assert http_client.is_closed


class TestFactory:
    def test_creates_the_matching_provider(self) -> None:
        assert isinstance(create_reranker("cohere", "k", "m"), CohereReranker)
        assert isinstance(create_reranker("voyage", "k", "m"), VoyageReranker)

    def test_rejects_unknown_providers(self) -> None:
        with pytest.raises(ValueError, match="Unsupported reranker provider"):
            create_reranker("none", "k", "m")
