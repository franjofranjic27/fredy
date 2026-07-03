from rag_eval.rerank.base import Reranker
from rag_eval.rerank.cohere import CohereReranker
from rag_eval.rerank.voyage import VoyageReranker


def create_reranker(provider: str, api_key: str, model: str) -> Reranker:
    match provider:
        case "cohere":
            return CohereReranker(api_key=api_key, model=model)
        case "voyage":
            return VoyageReranker(api_key=api_key, model=model)
        case _:
            raise ValueError(f"Unsupported reranker provider: {provider}")
