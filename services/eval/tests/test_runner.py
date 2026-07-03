from collections.abc import Sequence

import pytest

from rag_eval.dataset.models import EvalCase
from rag_eval.runner.eval_runner import EvalRunner, RunnerContext, RunnerOptions, aggregate
from rag_eval.store.pgvector import SearchHit


class FakeEmbedding:
    model = "fake-embedding-model"
    dimensions = 3

    def __init__(self) -> None:
        self.queries: list[str] = []

    def embed_query(self, text: str) -> list[float]:
        self.queries.append(text)
        return [0.1, 0.2, 0.3]


class FakeStore:
    """Returns a fixed ranking per query text."""

    def __init__(self, hits_by_query: dict[str, list[SearchHit]]) -> None:
        self._hits_by_query = hits_by_query
        self._last_query: str | None = None
        self.search_calls: list[tuple[int, float]] = []

    def bind_embedding(self, embedding: FakeEmbedding) -> "FakeStore":
        self._embedding = embedding
        return self

    def search(
        self, query_vector: Sequence[float], limit: int, score_threshold: float = 0.0
    ) -> list[SearchHit]:
        self.search_calls.append((limit, score_threshold))
        query = self._embedding.queries[-1]
        return self._hits_by_query.get(query, [])


class FakeReranker:
    provider = "fake"
    model = "fake-rerank-model"

    def __init__(self, ranking: list[tuple[str, float]]) -> None:
        self._ranking = ranking
        self.calls: list[tuple[str, list[tuple[str, str]], int]] = []

    def rerank(
        self, query: str, candidates: Sequence[tuple[str, str]], top_n: int
    ) -> list[tuple[str, float]]:
        self.calls.append((query, list(candidates), top_n))
        candidate_ids = {chunk_id for chunk_id, _ in candidates}
        return [(cid, score) for cid, score in self._ranking if cid in candidate_ids][:top_n]


def case(query_id: str, query: str, relevant: list[str]) -> EvalCase:
    return EvalCase(queryId=query_id, query=query, relevantChunkIds=relevant, source="synthetic")


def hit(chunk_id: str, score: float) -> SearchHit:
    return SearchHit(chunk_id=chunk_id, content=f"content of {chunk_id}", score=score)


CONTEXT = RunnerContext(
    profile="default",
    vector_table="chunks",
    embedding_provider="openai",
    dataset_path="data/golden.jsonl",
)


def build_runner(
    hits_by_query: dict[str, list[SearchHit]],
    reranker: FakeReranker | None = None,
    **option_overrides: object,
) -> tuple[EvalRunner, FakeStore]:
    options_kwargs: dict = {"k_values": [1, 3], "search_limit": 10, "score_threshold": 0.0}
    options_kwargs.update(option_overrides)
    embedding = FakeEmbedding()
    store = FakeStore(hits_by_query).bind_embedding(embedding)
    runner = EvalRunner(embedding, store, RunnerOptions(**options_kwargs), reranker=reranker)
    return runner, store


class TestRunWithoutReranker:
    def test_computes_per_query_and_aggregated_metrics(self) -> None:
        runner, store = build_runner(
            {
                "q one": [hit("a", 0.9), hit("x", 0.8), hit("b", 0.7)],
                "q two": [hit("x", 0.9), hit("y", 0.8)],
            }
        )
        cases = [case("q_001", "q one", ["a", "b"]), case("q_002", "q two", ["z"])]

        report = runner.run(cases, CONTEXT)

        first = report["perQuery"][0]
        assert first["retrievedChunkIds"] == ["a", "x", "b"]
        assert first["retrievedScores"] == [0.9, 0.8, 0.7]
        assert first["metrics"]["precisionAtK"]["1"] == 1
        assert first["metrics"]["precisionAtK"]["3"] == pytest.approx(2 / 3)
        assert first["metrics"]["recallAtK"]["3"] == 1
        assert first["metrics"]["hitRate"] == 1
        assert first["metrics"]["reciprocalRank"] == 1

        second = report["perQuery"][1]
        assert second["metrics"]["hitRate"] == 0
        assert second["metrics"]["reciprocalRank"] == 0

        assert report["aggregated"]["hitRate"] == 0.5
        assert report["aggregated"]["mrr"] == 0.5
        assert report["aggregated"]["precisionAtK"]["1"] == 0.5

    def test_report_structure_matches_the_contract(self) -> None:
        runner, _ = build_runner({"q one": [hit("a", 0.9)]})

        report = runner.run([case("q_001", "q one", ["a"])], CONTEXT)

        assert set(report) == {"generatedAt", "config", "dataset", "aggregated", "perQuery"}
        assert report["config"] == {
            "profile": "default",
            "vectorTable": "chunks",
            "embeddingProvider": "openai",
            "embeddingModel": "fake-embedding-model",
            "searchLimit": 10,
            "scoreThreshold": 0.0,
            "kValues": [1, 3],
            "reranker": None,
        }
        assert report["dataset"] == {"path": "data/golden.jsonl", "queryCount": 1}
        assert "rerankedAggregated" not in report
        assert "rerankedMetrics" not in report["perQuery"][0]

    def test_passes_search_limit_and_threshold_to_the_store(self) -> None:
        runner, store = build_runner({"q one": []}, search_limit=25, score_threshold=0.42)

        runner.run([case("q_001", "q one", ["a"])], CONTEXT)

        assert store.search_calls == [(25, 0.42)]


class TestRunWithReranker:
    def test_reports_both_pre_and_post_rerank_metrics(self) -> None:
        # Vector search puts the relevant chunk last; the reranker fixes it.
        reranker = FakeReranker([("b", 0.95), ("x", 0.5), ("a", 0.4)])
        runner, _ = build_runner(
            {"q one": [hit("a", 0.9), hit("x", 0.8), hit("b", 0.7)]}, reranker=reranker
        )

        report = runner.run([case("q_001", "q one", ["b"])], CONTEXT)

        per_query = report["perQuery"][0]
        assert per_query["metrics"]["reciprocalRank"] == pytest.approx(1 / 3)
        assert per_query["rerankedChunkIds"] == ["b", "x", "a"]
        assert per_query["rerankedScores"] == [0.95, 0.5, 0.4]
        assert per_query["rerankedMetrics"]["reciprocalRank"] == 1

        assert report["aggregated"]["mrr"] == pytest.approx(1 / 3)
        assert report["rerankedAggregated"]["mrr"] == 1

    def test_reranker_config_appears_in_the_report(self) -> None:
        reranker = FakeReranker([])
        runner, _ = build_runner(
            {"q one": []}, reranker=reranker, rerank_top_n=5, rerank_threshold=0.35
        )

        report = runner.run([case("q_001", "q one", ["a"])], CONTEXT)

        assert report["config"]["reranker"] == {
            "provider": "fake",
            "model": "fake-rerank-model",
            "topN": 5,
            "threshold": 0.35,
        }

    def test_drops_reranked_results_below_the_threshold(self) -> None:
        reranker = FakeReranker([("a", 0.9), ("x", 0.34), ("b", 0.1)])
        runner, _ = build_runner(
            {"q one": [hit("a", 0.9), hit("x", 0.8), hit("b", 0.7)]},
            reranker=reranker,
            rerank_threshold=0.35,
        )

        report = runner.run([case("q_001", "q one", ["a", "b"])], CONTEXT)

        per_query = report["perQuery"][0]
        assert per_query["rerankedChunkIds"] == ["a"]
        assert per_query["rerankedScores"] == [0.9]
        # b was dropped by the threshold, so post-rerank recall suffers
        assert per_query["rerankedMetrics"]["recallAtK"]["3"] == 0.5
        assert per_query["metrics"]["recallAtK"]["3"] == 1

    def test_reranks_the_retrieved_candidates_with_top_n(self) -> None:
        reranker = FakeReranker([("a", 0.9)])
        runner, _ = build_runner(
            {"q one": [hit("a", 0.9), hit("x", 0.8)]}, reranker=reranker, rerank_top_n=7
        )

        runner.run([case("q_001", "q one", ["a"])], CONTEXT)

        query, candidates, top_n = reranker.calls[0]
        assert query == "q one"
        assert candidates == [("a", "content of a"), ("x", "content of x")]
        assert top_n == 7


class TestAggregate:
    def test_returns_zeros_for_empty_results(self) -> None:
        assert aggregate([], [1, 3]) == {
            "precisionAtK": {},
            "recallAtK": {},
            "ndcgAtK": {},
            "hitRate": 0,
            "mrr": 0,
        }

    def test_means_over_queries(self) -> None:
        metrics = [
            {
                "precisionAtK": {"1": 1.0},
                "recallAtK": {"1": 0.5},
                "ndcgAtK": {"1": 1.0},
                "hitRate": 1,
                "reciprocalRank": 1.0,
            },
            {
                "precisionAtK": {"1": 0.0},
                "recallAtK": {"1": 0.0},
                "ndcgAtK": {"1": 0.0},
                "hitRate": 0,
                "reciprocalRank": 0.0,
            },
        ]
        result = aggregate(metrics, [1])
        assert result["precisionAtK"]["1"] == 0.5
        assert result["recallAtK"]["1"] == 0.25
        assert result["hitRate"] == 0.5
        assert result["mrr"] == 0.5
