import json

import pytest

from confluence_importer.embeddings.base import EmbeddingApiError
from confluence_importer.embeddings.openai import OpenAIEmbedding


@pytest.fixture
def provider() -> OpenAIEmbedding:
    return OpenAIEmbedding(api_key="sk-test", model="text-embedding-3-small", dimensions=4)


def _response(count: int, *, reversed_order: bool = False) -> dict:
    indices = range(count - 1, -1, -1) if reversed_order else range(count)
    return {"data": [{"index": i, "embedding": [float(i)] * 4} for i in indices]}


def test_embeds_texts_with_model_and_dimensions(provider, httpx_mock):
    httpx_mock.add_response(json=_response(2))
    result = provider.embed_texts(["a", "b"])

    request = httpx_mock.get_requests()[0]
    assert request.url == "https://api.openai.com/v1/embeddings"
    payload = json.loads(request.content)
    assert payload == {
        "model": "text-embedding-3-small",
        "input": ["a", "b"],
        "dimensions": 4,
    }
    assert result == [[0.0] * 4, [1.0] * 4]


def test_sorts_embeddings_by_index(provider, httpx_mock):
    httpx_mock.add_response(json=_response(3, reversed_order=True))
    result = provider.embed_texts(["a", "b", "c"])
    assert result[0] == [0.0] * 4
    assert result[2] == [2.0] * 4


def test_batches_above_100_inputs(provider, httpx_mock):
    httpx_mock.add_response(json=_response(100))
    httpx_mock.add_response(json=_response(50))
    result = provider.embed_texts([f"text {i}" for i in range(150)])

    assert len(result) == 150
    requests = httpx_mock.get_requests()
    assert len(requests) == 2
    assert len(json.loads(requests[0].content)["input"]) == 100
    assert len(json.loads(requests[1].content)["input"]) == 50


def test_embed_query_returns_single_vector(provider, httpx_mock):
    httpx_mock.add_response(json=_response(1))
    assert provider.embed_query("question") == [0.0] * 4


def test_rejects_embeddings_with_wrong_dimensions(provider, httpx_mock):
    httpx_mock.add_response(json={"data": [{"index": 0, "embedding": [0.1, 0.2, 0.3]}]})
    with pytest.raises(
        ValueError, match=r"OpenAI model 'text-embedding-3-small' returned a 3-dimensional"
    ):
        provider.embed_texts(["a"])


def test_raises_on_client_error(provider, httpx_mock):
    httpx_mock.add_response(status_code=400, text="bad request")
    with pytest.raises(EmbeddingApiError, match=r"OpenAI embedding failed \(400\)"):
        provider.embed_texts(["a"])


def test_retries_on_server_error(provider, httpx_mock, monkeypatch):
    monkeypatch.setattr("confluence_importer.retry.time.sleep", lambda _s: None)
    httpx_mock.add_response(status_code=500, text="server error")
    httpx_mock.add_response(json=_response(1))
    assert provider.embed_texts(["a"]) == [[0.0] * 4]
    assert len(httpx_mock.get_requests()) == 2
