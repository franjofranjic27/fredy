import json

import pytest

from confluence_importer.embeddings.base import EmbeddingApiError
from confluence_importer.embeddings.voyage import VoyageEmbedding


@pytest.fixture
def provider() -> VoyageEmbedding:
    return VoyageEmbedding(api_key="v-test", model="voyage-2", dimensions=4)


def _response(count: int, *, with_index: bool = False, reversed_order: bool = False) -> dict:
    indices = range(count - 1, -1, -1) if reversed_order else range(count)
    items = []
    for i in indices:
        item: dict = {"embedding": [float(i)] * 4}
        if with_index:
            item["index"] = i
        items.append(item)
    return {"data": items}


def test_embeds_texts_as_documents(provider, httpx_mock):
    httpx_mock.add_response(json=_response(2))
    result = provider.embed_texts(["a", "b"])

    request = httpx_mock.get_requests()[0]
    assert request.url == "https://api.voyageai.com/v1/embeddings"
    payload = json.loads(request.content)
    assert payload == {"model": "voyage-2", "input": ["a", "b"], "input_type": "document"}
    assert len(result) == 2


def test_batches_above_128_inputs(provider, httpx_mock):
    httpx_mock.add_response(json=_response(128))
    httpx_mock.add_response(json=_response(10))
    result = provider.embed_texts([f"t{i}" for i in range(138)])
    assert len(result) == 138
    assert len(httpx_mock.get_requests()) == 2


def test_defaults_model_when_empty(httpx_mock):
    provider = VoyageEmbedding(api_key="v", model="")
    assert provider.model == "voyage-2"


def test_sorts_embeddings_by_index_when_present(provider, httpx_mock):
    httpx_mock.add_response(json=_response(3, with_index=True, reversed_order=True))
    result = provider.embed_texts(["a", "b", "c"])
    assert result[0] == [0.0] * 4
    assert result[2] == [2.0] * 4


def test_keeps_response_order_without_index(provider, httpx_mock):
    httpx_mock.add_response(json=_response(2))
    result = provider.embed_texts(["a", "b"])
    assert result == [[0.0] * 4, [1.0] * 4]


def test_rejects_embeddings_with_wrong_dimensions(provider, httpx_mock):
    httpx_mock.add_response(json={"data": [{"embedding": [0.1, 0.2]}]})
    with pytest.raises(ValueError, match=r"Voyage model 'voyage-2' returned a 2-dimensional"):
        provider.embed_texts(["a"])


def test_raises_on_error(provider, httpx_mock):
    httpx_mock.add_response(status_code=401, text="unauthorized")
    with pytest.raises(EmbeddingApiError, match=r"Voyage embedding failed \(401\)"):
        provider.embed_texts(["a"])
