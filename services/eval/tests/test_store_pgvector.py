import psycopg
import pytest

from rag_eval.config import Settings
from rag_eval.store.pgvector import (
    PgVectorStore,
    load_profile,
    quote_identifier,
    to_vector_literal,
)
from tests.fakes import FakeConnection


def settings_with_fallback() -> Settings:
    return Settings(
        EMBEDDING_PROVIDER="openai",
        EMBEDDING_MODEL="text-embedding-3-small",
        EMBEDDING_DIMENSIONS=1536,
        VECTOR_TABLE="chunks",
    )


class TestQuoteIdentifier:
    def test_quotes_valid_identifiers(self) -> None:
        assert quote_identifier("chunks") == '"chunks"'
        assert quote_identifier("chunks_exp1") == '"chunks_exp1"'
        assert quote_identifier("_private") == '"_private"'

    @pytest.mark.parametrize(
        "name", ["chunks; DROP TABLE x", "1chunks", "chu-nks", "", 'chu"nks', "chunks x"]
    )
    def test_rejects_invalid_identifiers(self, name: str) -> None:
        with pytest.raises(ValueError, match="Invalid table name"):
            quote_identifier(name)


class TestLoadProfile:
    def test_loads_profile_from_registry(self) -> None:
        conn = FakeConnection(
            [[("chunks_exp1", "voyage", "voyage-3", 1024, "recursive", {"size": 512})]]
        )

        profile = load_profile(conn, "exp1", settings_with_fallback())

        assert profile.profile_name == "exp1"
        assert profile.table_name == "chunks_exp1"
        assert profile.embedding_provider == "voyage"
        assert profile.embedding_model == "voyage-3"
        assert profile.embedding_dimensions == 1024
        assert profile.chunker == "recursive"
        assert profile.chunker_params == {"size": 512}
        sql, params = conn.calls[0]
        assert "FROM rag_profiles WHERE profile_name = %s" in sql
        assert params == ("exp1",)

    def test_falls_back_to_env_when_registry_table_is_missing(self) -> None:
        conn = FakeConnection([psycopg.errors.UndefinedTable("no rag_profiles")])

        profile = load_profile(conn, "default", settings_with_fallback())

        assert profile.table_name == "chunks"
        assert profile.embedding_provider == "openai"
        assert profile.embedding_model == "text-embedding-3-small"
        assert profile.embedding_dimensions == 1536

    def test_falls_back_to_env_when_profile_row_is_missing(self) -> None:
        conn = FakeConnection([[]])

        profile = load_profile(conn, "missing", settings_with_fallback())

        assert profile.profile_name == "missing"
        assert profile.table_name == "chunks"

    def test_raises_when_no_fallback_is_configured(self) -> None:
        conn = FakeConnection([[]])
        settings = Settings(EMBEDDING_PROVIDER=None, EMBEDDING_MODEL=None)

        with pytest.raises(ValueError, match="no env fallback"):
            load_profile(conn, "missing", settings)


class TestPgVectorStoreSearch:
    def test_maps_rows_to_search_hits(self) -> None:
        conn = FakeConnection([[("c1", "content 1", 0.91), ("c2", "content 2", 0.72)]])
        store = PgVectorStore(conn, "chunks")

        hits = store.search([0.1, 0.2], limit=5, score_threshold=0.5)

        assert [(h.chunk_id, h.content, h.score) for h in hits] == [
            ("c1", "content 1", 0.91),
            ("c2", "content 2", 0.72),
        ]

    def test_builds_cosine_similarity_query_with_threshold_and_order(self) -> None:
        conn = FakeConnection([[]])
        store = PgVectorStore(conn, "chunks")

        store.search([0.25, 0.5], limit=7, score_threshold=0.3)

        sql, params = conn.calls[0]
        assert "1 - (embedding <=> %(vec)s::vector) AS score" in sql
        assert 'FROM "chunks"' in sql
        assert "WHERE 1 - (embedding <=> %(vec)s::vector) >= %(threshold)s" in sql
        assert "ORDER BY embedding <=> %(vec)s::vector ASC" in sql
        assert "LIMIT %(limit)s" in sql
        assert params == {"vec": "[0.25,0.5]", "threshold": 0.3, "limit": 7}

    def test_rejects_unsafe_table_names(self) -> None:
        with pytest.raises(ValueError, match="Invalid table name"):
            PgVectorStore(FakeConnection([]), "chunks; DROP TABLE users")


def test_to_vector_literal_serializes_floats() -> None:
    assert to_vector_literal([0.25, -1.5, 2.0]) == "[0.25,-1.5,2.0]"
