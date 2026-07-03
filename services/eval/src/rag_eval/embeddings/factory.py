from rag_eval.embeddings.base import QueryEmbeddingClient
from rag_eval.embeddings.cohere import CohereQueryEmbedding
from rag_eval.embeddings.openai import OpenAIQueryEmbedding
from rag_eval.embeddings.voyage import VoyageQueryEmbedding


def create_embedding_client(
    provider: str, api_key: str, model: str, dimensions: int | None = None
) -> QueryEmbeddingClient:
    match provider:
        case "openai":
            return OpenAIQueryEmbedding(api_key=api_key, model=model, dimensions=dimensions)
        case "voyage":
            return VoyageQueryEmbedding(api_key=api_key, model=model, dimensions=dimensions)
        case "cohere":
            return CohereQueryEmbedding(api_key=api_key, model=model, dimensions=dimensions)
        case _:
            raise ValueError(f"Unsupported embedding provider: {provider}")
