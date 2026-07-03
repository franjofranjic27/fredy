import pytest

from rag_eval.config import Settings, parse_k_values


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """Isolate from the developer's shell environment."""
    for name in [
        "DATABASE_URL",
        "ANTHROPIC_API_KEY",
        "EMBEDDING_API_KEY",
        "EMBEDDING_PROVIDER",
        "EMBEDDING_MODEL",
        "EMBEDDING_DIMENSIONS",
        "VECTOR_TABLE",
        "CHUNKS_TABLE",
        "EVAL_DATASET_PATH",
        "EVAL_K_VALUES",
        "EVAL_SEARCH_LIMIT",
        "EVAL_SCORE_THRESHOLD",
        "EVAL_REPORTS_DIR",
        "RERANKER",
        "RERANK_API_KEY",
        "RERANK_MODEL",
        "RERANK_TOP_N",
        "RERANK_THRESHOLD",
    ]:
        monkeypatch.delenv(name, raising=False)


class TestDefaults:
    def test_sensible_defaults(self) -> None:
        settings = Settings()

        assert settings.database_url == "postgresql://fredy:fredy@localhost:5432/fredy"
        assert settings.vector_table == "chunks"
        assert settings.eval_dataset_path == "data/golden.jsonl"
        assert settings.k_values == [1, 3, 5, 10]
        assert settings.eval_search_limit == 20
        assert settings.eval_score_threshold == 0.0
        assert settings.eval_reports_dir == "reports"
        assert settings.reranker == "none"
        assert settings.rerank_top_n == 10
        assert settings.rerank_threshold == 0.0


class TestEnvBinding:
    def test_reads_values_from_the_environment(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("EVAL_K_VALUES", "5,1,5")
        monkeypatch.setenv("RERANKER", "cohere")
        monkeypatch.setenv("EVAL_SEARCH_LIMIT", "30")

        settings = Settings()

        assert settings.k_values == [1, 5]
        assert settings.reranker == "cohere"
        assert settings.eval_search_limit == 30

    def test_supports_the_legacy_chunks_table_alias(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("CHUNKS_TABLE", "legacy_chunks")
        assert Settings().vector_table == "legacy_chunks"

    def test_rejects_invalid_k_values_from_env(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("EVAL_K_VALUES", "1,zero")
        with pytest.raises(ValueError):
            Settings()


class TestParseKValues:
    def test_sorts_and_deduplicates(self) -> None:
        assert parse_k_values("10, 1,3, 3") == [1, 3, 10]

    def test_skips_empty_segments(self) -> None:
        assert parse_k_values("1,,3,") == [1, 3]

    def test_rejects_non_integers(self) -> None:
        with pytest.raises(ValueError, match="invalid value"):
            parse_k_values("1,two")

    def test_rejects_non_positive_values(self) -> None:
        with pytest.raises(ValueError, match="invalid value"):
            parse_k_values("0,3")
        with pytest.raises(ValueError, match="invalid value"):
            parse_k_values("-1")

    def test_rejects_empty_input(self) -> None:
        with pytest.raises(ValueError, match="at least one"):
            parse_k_values(" , ")


class TestRerankModelDefaults:
    def test_defaults_per_provider(self) -> None:
        settings = Settings()
        assert settings.resolved_rerank_model("cohere") == "rerank-v3.5"
        assert settings.resolved_rerank_model("voyage") == "rerank-2.5"

    def test_explicit_model_wins(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("RERANK_MODEL", "rerank-custom")
        assert Settings().resolved_rerank_model("cohere") == "rerank-custom"

    def test_rejects_unknown_provider(self) -> None:
        with pytest.raises(ValueError, match="Unsupported reranker"):
            Settings().resolved_rerank_model("hal9000")
