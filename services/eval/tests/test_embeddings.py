import json

import httpx
import pytest
from pytest_httpx import HTTPXMock

from rag_eval.embeddings.cohere import CohereQueryEmbedding
from rag_eval.embeddings.factory import create_embedding_client
from rag_eval.embeddings.openai import OpenAIQueryEmbedding
from rag_eval.embeddings.voyage import VoyageQueryEmbedding
from rag_eval.http_retry import ApiRequestError


class TestOpenAI:
    def test_embeds_a_query(self, httpx_mock: HTTPXMock) -> None:
        httpx_mock.add_response(
            url="https://api.openai.com/v1/embeddings",
            json={"data": [{"index": 0, "embedding": [0.1, 0.2]}]},
        )
        client = OpenAIQueryEmbedding(api_key="k", model="text-embedding-3-small")

        assert client.embed_query("hello") == [0.1, 0.2]
        request = httpx_mock.get_request()
        assert request is not None
        assert request.headers["Authorization"] == "Bearer k"
        body = json.loads(request.content)
        assert body == {
            "model": "text-embedding-3-small",
            "input": ["hello"],
            "dimensions": 1536,
        }

    def test_respects_explicit_dimensions(self, httpx_mock: HTTPXMock) -> None:
        httpx_mock.add_response(
            url="https://api.openai.com/v1/embeddings",
            json={"data": [{"index": 0, "embedding": [0.1]}]},
        )
        client = OpenAIQueryEmbedding(api_key="k", model="m", dimensions=256)
        client.embed_query("x")
        body = json.loads(httpx_mock.get_request().content)
        assert body["dimensions"] == 256


class TestVoyage:
    def test_embeds_with_query_input_type(self, httpx_mock: HTTPXMock) -> None:
        httpx_mock.add_response(
            url="https://api.voyageai.com/v1/embeddings",
            json={"data": [{"embedding": [0.3, 0.4]}]},
        )
        client = VoyageQueryEmbedding(api_key="k", model="voyage-3")

        assert client.embed_query("hello") == [0.3, 0.4]
        body = json.loads(httpx_mock.get_request().content)
        assert body == {"model": "voyage-3", "input": ["hello"], "input_type": "query"}

    def test_defaults_model_when_empty(self) -> None:
        client = VoyageQueryEmbedding(api_key="k", model="")
        assert client.model == "voyage-2"
        assert client.dimensions == 1024


class TestCohere:
    def test_embeds_with_search_query_input_type(self, httpx_mock: HTTPXMock) -> None:
        httpx_mock.add_response(
            url="https://api.cohere.com/v2/embed",
            json={"embeddings": {"float": [[0.5, 0.6]]}},
        )
        client = CohereQueryEmbedding(api_key="k", model="embed-v4.0")

        assert client.embed_query("hello") == [0.5, 0.6]
        body = json.loads(httpx_mock.get_request().content)
        assert body == {
            "model": "embed-v4.0",
            "texts": ["hello"],
            "input_type": "search_query",
            "embedding_types": ["float"],
        }

    def test_defaults_model_when_empty(self) -> None:
        client = CohereQueryEmbedding(api_key="k", model="")
        assert client.model == "embed-multilingual-v3.0"


class TestRetry:
    @pytest.fixture(autouse=True)
    def _no_backoff_delay(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr("rag_eval.http_retry.time.sleep", lambda _seconds: None)

    def test_retries_on_retryable_status_and_succeeds(self, httpx_mock: HTTPXMock) -> None:
        httpx_mock.add_response(url="https://api.openai.com/v1/embeddings", status_code=429)
        httpx_mock.add_response(
            url="https://api.openai.com/v1/embeddings",
            json={"data": [{"index": 0, "embedding": [1.0]}]},
        )
        client = OpenAIQueryEmbedding(api_key="k", model="m")

        assert client.embed_query("x") == [1.0]
        assert len(httpx_mock.get_requests()) == 2

    def test_does_not_retry_on_client_error(self, httpx_mock: HTTPXMock) -> None:
        httpx_mock.add_response(
            url="https://api.openai.com/v1/embeddings", status_code=401, text="bad key"
        )
        client = OpenAIQueryEmbedding(api_key="k", model="m")

        with pytest.raises(ApiRequestError, match="401"):
            client.embed_query("x")
        assert len(httpx_mock.get_requests()) == 1

    def test_fails_after_exhausting_attempts(self, httpx_mock: HTTPXMock) -> None:
        for _ in range(3):
            httpx_mock.add_response(url="https://api.openai.com/v1/embeddings", status_code=503)
        client = OpenAIQueryEmbedding(api_key="k", model="m")

        with pytest.raises(ApiRequestError, match="503"):
            client.embed_query("x")
        assert len(httpx_mock.get_requests()) == 3


class TestClose:
    @pytest.mark.parametrize(
        "provider_cls", [OpenAIQueryEmbedding, VoyageQueryEmbedding, CohereQueryEmbedding]
    )
    def test_close_shuts_down_the_http_client(self, provider_cls: type) -> None:
        http_client = httpx.Client()
        client = provider_cls(api_key="k", model="m", client=http_client)

        client.close()

        assert http_client.is_closed

    @pytest.mark.parametrize(
        "provider_cls", [OpenAIQueryEmbedding, VoyageQueryEmbedding, CohereQueryEmbedding]
    )
    def test_usable_as_context_manager(self, provider_cls: type) -> None:
        http_client = httpx.Client()
        with provider_cls(api_key="k", model="m", client=http_client) as client:
            assert client.model == "m"
        assert http_client.is_closed


class TestFactory:
    def test_creates_the_matching_provider(self) -> None:
        assert isinstance(create_embedding_client("openai", "k", "m"), OpenAIQueryEmbedding)
        assert isinstance(create_embedding_client("voyage", "k", "m"), VoyageQueryEmbedding)
        assert isinstance(create_embedding_client("cohere", "k", "m"), CohereQueryEmbedding)

    def test_rejects_unknown_providers(self) -> None:
        with pytest.raises(ValueError, match="Unsupported embedding provider"):
            create_embedding_client("hal9000", "k", "m")
