"""PostgreSQL + pgvector store for chunks, attachments and the RAG profile registry.

Distance is cosine: the ``<=>`` operator yields a cosine *distance*, so
similarity is computed as ``1 - (embedding <=> query)`` — identical to the TS
implementation (including the score threshold semantics).

Table names are the only identifiers interpolated into SQL and are validated
against ``^[A-Za-z_][A-Za-z0-9_]*$``; every value is a bound parameter.
"""

import json
import re
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any, Protocol

from psycopg import Connection
from psycopg_pool import ConnectionPool

from confluence_importer.chunking.base import Chunk
from confluence_importer.profiles import RagProfile

_UPSERT_BATCH_SIZE = 100
_IDENTIFIER_PATTERN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


@dataclass(frozen=True)
class SearchResult:
    chunk: Chunk
    score: float


class _PoolLike(Protocol):
    def connection(self) -> Any: ...

    def close(self) -> None: ...


def _validate_identifier(name: str) -> str:
    if not _IDENTIFIER_PATTERN.match(name):
        raise ValueError(f"Invalid table name: {name}")
    return name


class PgVectorStore:
    def __init__(
        self,
        database_url: str,
        table_name: str,
        vector_size: int,
        pool: _PoolLike | None = None,
    ) -> None:
        _validate_identifier(table_name)
        self._table_bare = table_name
        self._table = f'"{table_name}"'
        self._vector_size = vector_size
        if pool is None:
            self._pool: _PoolLike = ConnectionPool(database_url, open=False)
            self._opened = False
        else:
            self._pool = pool
            self._opened = True

    @contextmanager
    def _connect(self) -> Iterator[Connection]:
        if not self._opened:
            self._pool.open()  # type: ignore[attr-defined]
            self._opened = True
        with self._pool.connection() as conn:
            yield conn

    # -- schema ------------------------------------------------------------

    def init_schema(self) -> None:
        """Create extension, chunks table, indexes and registry tables. Idempotent."""
        with self._connect() as conn:
            conn.execute("CREATE EXTENSION IF NOT EXISTS vector;")
            conn.execute(
                f"""
                CREATE TABLE IF NOT EXISTS {self._table} (
                    chunk_id   TEXT PRIMARY KEY,
                    page_id    TEXT NOT NULL,
                    space_key  TEXT,
                    title      TEXT,
                    url        TEXT,
                    content    TEXT NOT NULL,
                    labels     TEXT[] NOT NULL DEFAULT '{{}}',
                    metadata   JSONB NOT NULL DEFAULT '{{}}',
                    embedding  VECTOR({self._vector_size}) NOT NULL
                );
                """
            )
            conn.execute(
                f"CREATE INDEX IF NOT EXISTS {self._index_name('embedding_idx')} "
                f"ON {self._table} USING hnsw (embedding vector_cosine_ops);"
            )
            conn.execute(
                f"CREATE INDEX IF NOT EXISTS {self._index_name('space_key_idx')} "
                f"ON {self._table} (space_key);"
            )
            conn.execute(
                f"CREATE INDEX IF NOT EXISTS {self._index_name('page_id_idx')} "
                f"ON {self._table} (page_id);"
            )
            conn.execute(
                f"CREATE INDEX IF NOT EXISTS {self._index_name('labels_idx')} "
                f"ON {self._table} USING gin (labels);"
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS rag_profiles (
                    profile_name         TEXT PRIMARY KEY,
                    chunker              TEXT NOT NULL,
                    chunker_params       JSONB NOT NULL DEFAULT '{}',
                    embedding_provider   TEXT NOT NULL,
                    embedding_model      TEXT NOT NULL,
                    embedding_dimensions INT NOT NULL,
                    table_name           TEXT NOT NULL,
                    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
                    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
                );
                """
            )

    def init_attachments_schema(self) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS attachments (
                    attachment_id TEXT PRIMARY KEY,
                    page_id       TEXT NOT NULL,
                    filename      TEXT,
                    media_type    TEXT,
                    file_size     BIGINT,
                    url           TEXT,
                    data          BYTEA,
                    caption       TEXT,
                    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
                );
                """
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS attachments_page_id_idx ON attachments (page_id);"
            )

    # -- profile registry ----------------------------------------------------

    def upsert_profile(self, profile: RagProfile) -> None:
        """Register the profile so eval tooling can discover experiments."""
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO rag_profiles
                    (profile_name, chunker, chunker_params, embedding_provider,
                     embedding_model, embedding_dimensions, table_name)
                VALUES (%s, %s, %s::jsonb, %s, %s, %s, %s)
                ON CONFLICT (profile_name) DO UPDATE SET
                    chunker              = EXCLUDED.chunker,
                    chunker_params       = EXCLUDED.chunker_params,
                    embedding_provider   = EXCLUDED.embedding_provider,
                    embedding_model      = EXCLUDED.embedding_model,
                    embedding_dimensions = EXCLUDED.embedding_dimensions,
                    table_name           = EXCLUDED.table_name,
                    updated_at           = now();
                """,
                (
                    profile.name,
                    profile.chunker,
                    json.dumps(profile.chunker_params),
                    profile.embedding_provider,
                    profile.embedding_model,
                    profile.embedding_dimensions,
                    profile.table_name,
                ),
            )

    # -- chunks ---------------------------------------------------------------

    def upsert_chunks(self, chunks: list[Chunk], embeddings: list[list[float]]) -> None:
        if len(chunks) != len(embeddings):
            raise ValueError("Chunks and embeddings count mismatch")

        for start in range(0, len(chunks), _UPSERT_BATCH_SIZE):
            with self._connect() as conn:
                self._upsert_batch(
                    conn,
                    chunks[start : start + _UPSERT_BATCH_SIZE],
                    embeddings[start : start + _UPSERT_BATCH_SIZE],
                )

    def replace_page_chunks(
        self, page_id: str, chunks: list[Chunk], embeddings: list[list[float]]
    ) -> None:
        """Atomically replace all chunks of a page (DELETE + INSERT in one transaction).

        Callers embed first and only then swap the stored chunks, so a failure
        never leaves the page without its previous chunks.
        """
        if len(chunks) != len(embeddings):
            raise ValueError("Chunks and embeddings count mismatch")

        with self._connect() as conn, conn.transaction():
            conn.execute(f"DELETE FROM {self._table} WHERE page_id = %s;", (page_id,))
            for start in range(0, len(chunks), _UPSERT_BATCH_SIZE):
                self._upsert_batch(
                    conn,
                    chunks[start : start + _UPSERT_BATCH_SIZE],
                    embeddings[start : start + _UPSERT_BATCH_SIZE],
                )

    def _upsert_batch(
        self, conn: Connection, chunks: list[Chunk], embeddings: list[list[float]]
    ) -> None:
        rows = []
        for chunk, embedding in zip(chunks, embeddings, strict=True):
            metadata = dict(chunk.metadata)
            page_id = metadata.pop("pageId", None)
            space_key = metadata.pop("spaceKey", None)
            title = metadata.pop("title", None)
            url = metadata.pop("url", None)
            labels = metadata.pop("labels", None) or []
            rows.append(
                (
                    chunk.id,
                    page_id,
                    space_key,
                    title,
                    url,
                    chunk.content,
                    labels,
                    json.dumps(metadata),
                    _to_vector_literal(embedding),
                )
            )

        sql = f"""
            INSERT INTO {self._table}
                (chunk_id, page_id, space_key, title, url, content, labels, metadata, embedding)
            VALUES (%s, %s, %s, %s, %s, %s, %s::text[], %s::jsonb, %s::vector)
            ON CONFLICT (chunk_id) DO UPDATE SET
                page_id   = EXCLUDED.page_id,
                space_key = EXCLUDED.space_key,
                title     = EXCLUDED.title,
                url       = EXCLUDED.url,
                content   = EXCLUDED.content,
                labels    = EXCLUDED.labels,
                metadata  = EXCLUDED.metadata,
                embedding = EXCLUDED.embedding;
        """

        with conn.cursor() as cursor:
            cursor.executemany(sql, rows)

    def delete_page_chunks(self, page_id: str) -> None:
        with self._connect() as conn:
            conn.execute(f"DELETE FROM {self._table} WHERE page_id = %s;", (page_id,))

    def truncate(self) -> None:
        with self._connect() as conn:
            conn.execute(f"TRUNCATE {self._table};")

    def search(
        self,
        query_vector: list[float],
        *,
        limit: int = 5,
        space_key: str | None = None,
        labels: list[str] | None = None,
        score_threshold: float = 0.7,
    ) -> list[SearchResult]:
        params: dict[str, Any] = {
            "query": _to_vector_literal(query_vector),
            "threshold": score_threshold,
            "limit": limit,
        }
        filters = ""
        if space_key:
            params["space_key"] = space_key
            filters += "\n              AND space_key = %(space_key)s"
        if labels:
            params["labels"] = labels
            filters += "\n              AND labels && %(labels)s::text[]"

        sql = f"""
            SELECT chunk_id, page_id, space_key, title, url, content, labels, metadata,
                   1 - (embedding <=> %(query)s::vector) AS score
            FROM {self._table}
            WHERE (1 - (embedding <=> %(query)s::vector)) >= %(threshold)s{filters}
            ORDER BY embedding <=> %(query)s::vector ASC
            LIMIT %(limit)s;
        """

        with self._connect() as conn:
            rows = conn.execute(sql, params).fetchall()

        return [SearchResult(chunk=_row_to_chunk(row[:8]), score=float(row[8])) for row in rows]

    def get_collection_info(self) -> dict[str, int]:
        """pgvector has no separate "indexed" count, so both values report the row count."""
        with self._connect() as conn:
            row = conn.execute(f"SELECT count(*)::bigint FROM {self._table};").fetchone()
        count = int(row[0]) if row else 0
        return {"points_count": count, "indexed_vectors_count": count}

    def count_by_space(self) -> dict[str, int]:
        with self._connect() as conn:
            rows = conn.execute(
                f"""
                SELECT space_key, count(*)::bigint
                FROM {self._table}
                WHERE space_key IS NOT NULL
                GROUP BY space_key;
                """
            ).fetchall()
        return {row[0]: int(row[1]) for row in rows if row[0]}

    def list_stored_page_ids(self, space_key: str | None = None) -> list[str]:
        sql = f"SELECT DISTINCT page_id FROM {self._table}"
        params: tuple[str, ...] | None = None
        if space_key is not None:
            sql += " WHERE space_key = %s"
            params = (space_key,)
        with self._connect() as conn:
            rows = conn.execute(f"{sql};", params).fetchall()
        return [row[0] for row in rows]

    def sample_recent_chunks(self, n: int) -> list[Chunk]:
        with self._connect() as conn:
            rows = conn.execute(
                f"""
                SELECT chunk_id, page_id, space_key, title, url, content, labels, metadata
                FROM {self._table}
                LIMIT %s;
                """,
                (n,),
            ).fetchall()
        return [_row_to_chunk(row) for row in rows]

    # -- attachments ---------------------------------------------------------

    def upsert_attachment(
        self,
        *,
        attachment_id: str,
        page_id: str,
        filename: str,
        media_type: str,
        file_size: int,
        url: str,
        data: bytes,
        caption: str | None,
    ) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO attachments
                    (attachment_id, page_id, filename, media_type, file_size, url, data, caption)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (attachment_id) DO UPDATE SET
                    page_id    = EXCLUDED.page_id,
                    filename   = EXCLUDED.filename,
                    media_type = EXCLUDED.media_type,
                    file_size  = EXCLUDED.file_size,
                    url        = EXCLUDED.url,
                    data       = EXCLUDED.data,
                    caption    = EXCLUDED.caption;
                """,
                (attachment_id, page_id, filename, media_type, file_size, url, data, caption),
            )

    def delete_page_attachments(self, page_id: str) -> None:
        with self._connect() as conn:
            conn.execute("DELETE FROM attachments WHERE page_id = %s;", (page_id,))

    def close(self) -> None:
        self._pool.close()

    def _index_name(self, suffix: str) -> str:
        return f'"{self._table_bare}_{suffix}"'


def _to_vector_literal(embedding: list[float]) -> str:
    return "[" + ",".join(_format_number(value) for value in embedding) + "]"


def _format_number(value: float) -> str:
    # Render integers without a trailing ".0" for compact literals.
    return repr(value) if not value.is_integer() else str(int(value))


def _row_to_chunk(row: tuple[Any, ...]) -> Chunk:
    chunk_id, page_id, space_key, title, url, content, labels, metadata = row
    merged: dict[str, Any] = dict(metadata or {})
    merged.update(
        pageId=page_id,
        spaceKey=space_key,
        title=title,
        url=url,
        labels=list(labels or []),
    )
    return Chunk(id=chunk_id, content=content, metadata=merged)
