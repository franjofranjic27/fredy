import json

import pytest

from confluence_importer.chunking.base import Chunk
from confluence_importer.store.pgvector import PgVectorStore
from tests.fakes import FakePool, make_profile


def make_chunk(chunk_id: str) -> Chunk:
    return Chunk(
        id=chunk_id,
        content=f"content of {chunk_id}",
        metadata={
            "pageId": "p1",
            "title": "Test Page",
            "spaceKey": "IT",
            "spaceName": "IT Space",
            "labels": [],
            "author": "author",
            "lastModified": "2024-01-01T00:00:00Z",
            "version": 1,
            "url": "https://example.com",
            "ancestors": [],
            "chunkIndex": 0,
            "totalChunks": 1,
            "headerPath": [],
            "contentType": "text",
        },
    )


@pytest.fixture
def pool() -> FakePool:
    return FakePool()


@pytest.fixture
def store(pool: FakePool) -> PgVectorStore:
    return PgVectorStore("postgresql://x", "chunks", 1536, pool=pool)


class TestConstructor:
    @pytest.mark.parametrize("bad_name", ["bad name;", "1abc", "a-b", 'x"; DROP TABLE'])
    def test_rejects_invalid_table_names(self, bad_name):
        with pytest.raises(ValueError, match="Invalid table name"):
            PgVectorStore("postgresql://x", bad_name, 1536, pool=FakePool())

    def test_accepts_valid_identifier(self):
        PgVectorStore("postgresql://x", "chunks_exp_1", 1536, pool=FakePool())


class TestInitSchema:
    def test_creates_extension_table_and_indexes(self, store, pool):
        store.init_schema()
        statements = pool.statements
        assert any("CREATE EXTENSION IF NOT EXISTS vector" in s for s in statements)
        assert any("CREATE TABLE IF NOT EXISTS" in s for s in statements)
        assert any("USING hnsw (embedding vector_cosine_ops)" in s for s in statements)
        assert any("USING gin (labels)" in s for s in statements)
        assert any("VECTOR(1536)" in s for s in statements)

    def test_creates_rag_profiles_registry(self, store, pool):
        store.init_schema()
        assert any("CREATE TABLE IF NOT EXISTS rag_profiles" in s for s in pool.statements)

    def test_creates_attachments_schema(self, store, pool):
        store.init_attachments_schema()
        assert any("CREATE TABLE IF NOT EXISTS attachments" in s for s in pool.statements)
        assert any("attachments_page_id_idx" in s for s in pool.statements)


class TestUpsertProfile:
    def test_upserts_profile_row(self, store, pool):
        store.upsert_profile(make_profile("exp1"))
        sql, params = pool.executed[0]
        assert "INSERT INTO rag_profiles" in sql
        assert "ON CONFLICT (profile_name) DO UPDATE SET" in sql
        assert "updated_at           = now()" in sql
        assert params[0] == "exp1"
        assert params[6] == "chunks_exp1"
        assert json.loads(params[2]) == {"max_tokens": 800, "overlap_tokens": 100}


class TestUpsertChunks:
    def test_raises_on_count_mismatch(self, store):
        with pytest.raises(ValueError, match="mismatch"):
            store.upsert_chunks([make_chunk("c1")], [])

    def test_upserts_with_on_conflict_and_vector_literal(self, store, pool):
        store.upsert_chunks([make_chunk("c1")], [[0.1, 0.2, 0.3]])

        assert len(pool.executed) == 1
        sql, rows = pool.executed[0]
        assert "INSERT INTO" in sql
        assert "ON CONFLICT (chunk_id) DO UPDATE SET" in sql
        row = rows[0]
        assert row[0] == "c1"  # chunk_id first
        assert row[-1] == "[0.1,0.2,0.3]"  # pgvector literal
        # Fixed columns extracted, remaining metadata serialized as JSON.
        metadata = json.loads(row[7])
        assert "pageId" not in metadata
        assert metadata["contentType"] == "text"

    def test_upserts_in_batches_of_100(self, store, pool):
        chunks = [make_chunk(f"c{i}") for i in range(250)]
        embeddings = [[0.1]] * 250
        store.upsert_chunks(chunks, embeddings)
        # 250 chunks -> 3 executemany calls (100 + 100 + 50)
        assert len(pool.executed) == 3
        assert len(pool.executed[0][1]) == 100
        assert len(pool.executed[2][1]) == 50


class TestReplacePageChunks:
    def test_raises_on_count_mismatch(self, store):
        with pytest.raises(ValueError, match="mismatch"):
            store.replace_page_chunks("p1", [make_chunk("c1")], [])

    def test_deletes_and_inserts_in_one_transaction(self, store, pool):
        store.replace_page_chunks("p1", [make_chunk("c1")], [[0.1, 0.2, 0.3]])

        statements = pool.statements
        assert statements[0] == "BEGIN"
        assert statements[-1] == "COMMIT"
        assert any("DELETE FROM" in s and "WHERE page_id = %s" in s for s in statements)
        assert any("INSERT INTO" in s for s in statements)
        # DELETE comes before the INSERT, both inside BEGIN/COMMIT.
        delete_index = next(i for i, s in enumerate(statements) if "DELETE FROM" in s)
        insert_index = next(i for i, s in enumerate(statements) if "INSERT INTO" in s)
        assert 0 < delete_index < insert_index < len(statements) - 1

    def test_inserts_in_batches_of_100(self, store, pool):
        chunks = [make_chunk(f"c{i}") for i in range(250)]
        store.replace_page_chunks("p1", chunks, [[0.1]] * 250)

        insert_batches = [
            params for sql, params in pool.executed if isinstance(sql, str) and "INSERT" in sql
        ]
        assert [len(batch) for batch in insert_batches] == [100, 100, 50]

    def test_handles_empty_chunk_list(self, store, pool):
        store.replace_page_chunks("p1", [], [])

        statements = pool.statements
        assert any("DELETE FROM" in s for s in statements)
        assert not any("INSERT INTO" in s for s in statements)


class TestDeleteAndTruncate:
    def test_deletes_by_page_id(self, store, pool):
        store.delete_page_chunks("page-99")
        sql, params = pool.executed[0]
        assert "DELETE FROM" in sql
        assert "WHERE page_id = %s" in sql
        assert params == ("page-99",)

    def test_truncate(self, store, pool):
        store.truncate()
        assert 'TRUNCATE "chunks";' in pool.statements[0]


class TestSearch:
    def test_returns_mapped_search_results(self, store, pool):
        pool.results = [
            [
                (
                    "c1",
                    "p1",
                    "IT",
                    "Title",
                    "https://x.com",
                    "result content",
                    [],
                    {"spaceName": "IT Space", "contentType": "text"},
                    0.95,
                )
            ]
        ]
        results = store.search([0.1, 0.2])
        assert len(results) == 1
        assert results[0].score == 0.95
        assert results[0].chunk.id == "c1"
        assert results[0].chunk.content == "result content"
        assert results[0].chunk.metadata["spaceKey"] == "IT"
        assert results[0].chunk.metadata["spaceName"] == "IT Space"

    def test_computes_similarity_as_one_minus_cosine_distance(self, store, pool):
        store.search([0.1, 0.2], score_threshold=0.7)
        sql, params = pool.executed[0]
        assert "1 - (embedding <=> %(query)s::vector) AS score" in sql
        assert "(1 - (embedding <=> %(query)s::vector)) >= %(threshold)s" in sql
        assert "ORDER BY embedding <=> %(query)s::vector ASC" in sql
        assert params["query"] == "[0.1,0.2]"
        assert params["threshold"] == 0.7

    def test_returns_empty_list_without_results(self, store):
        assert store.search([0.1]) == []

    def test_applies_space_key_and_labels_filters(self, store, pool):
        store.search([0.1], space_key="IT", labels=["public"])
        sql, params = pool.executed[0]
        assert "space_key = %(space_key)s" in sql
        assert "labels && %(labels)s::text[]" in sql
        assert params["space_key"] == "IT"
        assert params["labels"] == ["public"]


class TestStats:
    def test_collection_info_reports_row_count(self, store, pool):
        pool.results = [[(42,)]]
        info = store.get_collection_info()
        assert info == {"points_count": 42, "indexed_vectors_count": 42}

    def test_collection_info_defaults_to_zero(self, store):
        info = store.get_collection_info()
        assert info == {"points_count": 0, "indexed_vectors_count": 0}

    def test_count_by_space(self, store, pool):
        pool.results = [[("IT", 2), ("DOCS", 1)]]
        assert store.count_by_space() == {"IT": 2, "DOCS": 1}

    def test_list_stored_page_ids(self, store, pool):
        pool.results = [[("p1",), ("p2",)]]
        assert store.list_stored_page_ids() == ["p1", "p2"]
        sql, params = pool.executed[0]
        assert "WHERE" not in sql
        assert params is None

    def test_list_stored_page_ids_filters_by_space(self, store, pool):
        pool.results = [[("p1",)]]
        assert store.list_stored_page_ids(space_key="IT") == ["p1"]
        sql, params = pool.executed[0]
        assert "WHERE space_key = %s" in sql
        assert params == ("IT",)

    def test_sample_recent_chunks_limits_rows(self, store, pool):
        store.sample_recent_chunks(3)
        sql, params = pool.executed[0]
        assert "LIMIT %s" in sql
        assert params == (3,)


class TestAttachments:
    def test_upsert_attachment(self, store, pool):
        store.upsert_attachment(
            attachment_id="att1",
            page_id="p1",
            filename="diagram.png",
            media_type="image/png",
            file_size=1234,
            url="https://x/download",
            data=b"png-bytes",
            caption="A diagram",
        )
        sql, params = pool.executed[0]
        assert "INSERT INTO attachments" in sql
        assert "ON CONFLICT (attachment_id) DO UPDATE SET" in sql
        assert params[0] == "att1"
        assert params[6] == b"png-bytes"
        assert params[7] == "A diagram"

    def test_delete_page_attachments(self, store, pool):
        store.delete_page_attachments("p1")
        sql, params = pool.executed[0]
        assert "DELETE FROM attachments WHERE page_id = %s" in sql
        assert params == ("p1",)


def test_close_closes_pool(store, pool):
    store.close()
    assert pool.closed
