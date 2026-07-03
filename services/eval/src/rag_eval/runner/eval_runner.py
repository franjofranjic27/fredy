from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Protocol

from rag_eval.dataset.models import EvalCase
from rag_eval.embeddings.base import QueryEmbeddingClient
from rag_eval.metrics import hit_rate, ndcg_at_k, precision_at_k, recall_at_k, reciprocal_rank
from rag_eval.rerank.base import Reranker
from rag_eval.store.pgvector import SearchHit


class VectorSearchStore(Protocol):
    def search(
        self, query_vector: Sequence[float], limit: int, score_threshold: float = 0.0
    ) -> list[SearchHit]: ...


@dataclass(frozen=True)
class RunnerOptions:
    k_values: list[int]
    search_limit: int
    score_threshold: float
    rerank_top_n: int = 10
    rerank_threshold: float = 0.0


@dataclass(frozen=True)
class RunnerContext:
    profile: str
    vector_table: str
    embedding_provider: str
    dataset_path: str


class EvalRunner:
    """Per query: embed → vector search → (optional) rerank → metrics.

    When a reranker is active the report contains BOTH pre-rerank and
    post-rerank metrics so the reranker's lift (or damage) is visible.
    Report keys are camelCase — the JSON structure is the stable contract
    carried over from the TypeScript version.
    """

    def __init__(
        self,
        embedding: QueryEmbeddingClient,
        store: VectorSearchStore,
        options: RunnerOptions,
        reranker: Reranker | None = None,
    ) -> None:
        self._embedding = embedding
        self._store = store
        self._options = options
        self._reranker = reranker

    def run(self, cases: Sequence[EvalCase], context: RunnerContext) -> dict[str, Any]:
        per_query = [self._evaluate_case(case) for case in cases]

        report: dict[str, Any] = {
            "generatedAt": datetime.now(UTC).isoformat(),
            "config": {
                "profile": context.profile,
                "vectorTable": context.vector_table,
                "embeddingProvider": context.embedding_provider,
                "embeddingModel": self._embedding.model,
                "searchLimit": self._options.search_limit,
                "scoreThreshold": self._options.score_threshold,
                "kValues": self._options.k_values,
                "reranker": self._reranker_config(),
            },
            "dataset": {
                "path": context.dataset_path,
                "queryCount": len(cases),
            },
            "aggregated": aggregate([q["metrics"] for q in per_query], self._options.k_values),
            "perQuery": per_query,
        }
        if self._reranker is not None:
            report["rerankedAggregated"] = aggregate(
                [q["rerankedMetrics"] for q in per_query], self._options.k_values
            )
        return report

    def _reranker_config(self) -> dict[str, Any] | None:
        if self._reranker is None:
            return None
        return {
            "provider": self._reranker.provider,
            "model": self._reranker.model,
            "topN": self._options.rerank_top_n,
            "threshold": self._options.rerank_threshold,
        }

    def _evaluate_case(self, case: EvalCase) -> dict[str, Any]:
        vector = self._embedding.embed_query(case.query)
        hits = self._store.search(
            vector, limit=self._options.search_limit, score_threshold=self._options.score_threshold
        )

        retrieved_ids = [hit.chunk_id for hit in hits]
        result: dict[str, Any] = {
            "queryId": case.query_id,
            "query": case.query,
            "relevantChunkIds": list(case.relevant_chunk_ids),
            "retrievedChunkIds": retrieved_ids,
            "retrievedScores": [hit.score for hit in hits],
            "metrics": compute_query_metrics(
                retrieved_ids, case.relevant_chunk_ids, self._options.k_values
            ),
        }

        if self._reranker is not None:
            reranked = self._rerank(case.query, hits)
            reranked_ids = [chunk_id for chunk_id, _ in reranked]
            result["rerankedChunkIds"] = reranked_ids
            result["rerankedScores"] = [score for _, score in reranked]
            result["rerankedMetrics"] = compute_query_metrics(
                reranked_ids, case.relevant_chunk_ids, self._options.k_values
            )

        return result

    def _rerank(self, query: str, hits: Sequence[SearchHit]) -> list[tuple[str, float]]:
        assert self._reranker is not None
        candidates = [(hit.chunk_id, hit.content) for hit in hits]
        reranked = self._reranker.rerank(query, candidates, self._options.rerank_top_n)
        return [
            (chunk_id, score)
            for chunk_id, score in reranked
            if score >= self._options.rerank_threshold
        ]


def compute_query_metrics(
    retrieved: Sequence[str], relevant: Sequence[str], k_values: Sequence[int]
) -> dict[str, Any]:
    precision: dict[str, float] = {}
    recall: dict[str, float] = {}
    ndcg: dict[str, float] = {}

    for k in k_values:
        key = str(k)
        precision[key] = precision_at_k(retrieved, relevant, k)
        recall[key] = recall_at_k(retrieved, relevant, k)
        ndcg[key] = ndcg_at_k(retrieved, relevant, k)

    return {
        "precisionAtK": precision,
        "recallAtK": recall,
        "ndcgAtK": ndcg,
        "hitRate": hit_rate(retrieved, relevant),
        "reciprocalRank": reciprocal_rank(retrieved, relevant),
    }


def aggregate(
    per_query_metrics: Sequence[dict[str, Any]], k_values: Sequence[int]
) -> dict[str, Any]:
    if not per_query_metrics:
        return {"precisionAtK": {}, "recallAtK": {}, "ndcgAtK": {}, "hitRate": 0, "mrr": 0}

    precision: dict[str, float] = {}
    recall: dict[str, float] = {}
    ndcg: dict[str, float] = {}

    for k in k_values:
        key = str(k)
        precision[key] = _mean([m["precisionAtK"][key] for m in per_query_metrics])
        recall[key] = _mean([m["recallAtK"][key] for m in per_query_metrics])
        ndcg[key] = _mean([m["ndcgAtK"][key] for m in per_query_metrics])

    return {
        "precisionAtK": precision,
        "recallAtK": recall,
        "ndcgAtK": ndcg,
        "hitRate": _mean([m["hitRate"] for m in per_query_metrics]),
        "mrr": _mean([m["reciprocalRank"] for m in per_query_metrics]),
    }


def _mean(values: Sequence[float]) -> float:
    if not values:
        return 0.0
    return sum(values) / len(values)
