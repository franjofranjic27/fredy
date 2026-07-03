import json

import pytest

from confluence_importer.embeddings.base import EmbeddingApiError, create_embedding_provider
from confluence_importer.embeddings.cohere import CohereEmbedding


@pytest.fixture
def provider() -> CohereEmbedding:
    return CohereEmbedding(api_key="c-test", model="embed-multilingual-v3.0", dimensions=4)


def _response(count: int) -> dict:
    return {"embeddings": {"float": [[float(i)] * 4 for i in range(count)]}}


def test_embeds_texts_as_search_documents(provider, httpx_mock):
    httpx_mock.add_response(json=_response(2))
    result = provider.embed_texts(["a", "b"])

    request = httpx_mock.get_requests()[0]
    assert request.url == "https://api.cohere.com/v2/embed"
    payload = json.loads(request.content)
    assert payload == {
        "model": "embed-multilingual-v3.0",
        "texts": ["a", "b"],
        "input_type": "search_document",
        "embedding_types": ["float"],
    }
    assert len(result) == 2


def test_batches_above_96_inputs(provider, httpx_mock):
    httpx_mock.add_response(json=_response(96))
    httpx_mock.add_response(json=_response(4))
    result = provider.embed_texts([f"t{i}" for i in range(100)])
    assert len(result) == 100
    assert len(httpx_mock.get_requests()) == 2


def test_rejects_embeddings_with_wrong_dimensions(provider, httpx_mock):
    httpx_mock.add_response(json={"embeddings": {"float": [[0.1, 0.2]]}})
    with pytest.raises(
        ValueError, match=r"Cohere model 'embed-multilingual-v3.0' returned a 2-dimensional"
    ):
        provider.embed_texts(["a"])


def test_raises_on_error(provider, httpx_mock):
    httpx_mock.add_response(status_code=403, text="forbidden")
    with pytest.raises(EmbeddingApiError, match=r"Cohere embedding failed \(403\)"):
        provider.embed_texts(["a"])


class TestFactory:
    def test_creates_each_provider(self):
        for name in ("openai", "voyage", "cohere"):
            provider = create_embedding_provider(name, api_key="k", model="m", dimensions=8)
            assert provider.dimensions == 8

    def test_rejects_unknown_provider(self):
        with pytest.raises(ValueError, match="Unknown embedding provider"):
            create_embedding_provider("hf", api_key="k", model="m", dimensions=8)
