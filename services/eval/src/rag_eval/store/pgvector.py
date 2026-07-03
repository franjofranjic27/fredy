import re
import sys
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, Protocol

import psycopg

from rag_eval.config import Settings

IDENTIFIER_PATTERN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


class ConnectionLike(Protocol):
    """Minimal psycopg connection surface used here, kept narrow for testability."""

    def execute(self, query: str, params: Any = None) -> Any: ...


@dataclass(frozen=True)
class RagProfile:
    """One row of the importer's ``rag_profiles`` registry (or the env fallback)."""

    profile_name: str
    table_name: str
    embedding_provider: str
    embedding_model: str
    embedding_dimensions: int | None
    chunker: str | None = None
    chunker_params: dict[str, Any] | None = None


@dataclass(frozen=True)
class SearchHit:
    chunk_id: str
    content: str
    score: float


def quote_identifier(name: str) -> str:
    """Validate and quote a SQL identifier before string interpolation.

    Values are always parameterized; identifiers cannot be, so they are
    restricted to a safe character set instead.
    """
    if not IDENTIFIER_PATTERN.match(name):
        raise ValueError(
            f'Invalid table name "{name}". Only letters, digits and underscores are allowed.'
        )
    return f'"{name}"'


def load_profile(conn: ConnectionLike, profile_name: str, settings: Settings) -> RagProfile:
    """Resolve a RAG profile from the ``rag_profiles`` registry.

    Falls back to env config (VECTOR_TABLE, EMBEDDING_*) when the registry
    table does not exist or the profile row is missing, so the tool keeps
    working against a plain ``chunks`` table.
    """
    row = _fetch_profile_row(conn, profile_name)
    if row is not None:
        table_name, provider, model, dimensions, chunker, chunker_params = row
        return RagProfile(
            profile_name=profile_name,
            table_name=table_name,
            embedding_provider=provider,
            embedding_model=model,
            embedding_dimensions=dimensions,
            chunker=chunker,
            chunker_params=chunker_params,
        )

    return _fallback_profile(profile_name, settings)


def _fetch_profile_row(conn: ConnectionLike, profile_name: str) -> tuple[Any, ...] | None:
    try:
        cursor = conn.execute(
            "SELECT table_name, embedding_provider, embedding_model, embedding_dimensions, "
            "chunker, chunker_params FROM rag_profiles WHERE profile_name = %s",
            (profile_name,),
        )
        return cursor.fetchone()
    except psycopg.errors.UndefinedTable:
        return None


def _fallback_profile(profile_name: str, settings: Settings) -> RagProfile:
    if settings.embedding_provider is None or settings.embedding_model is None:
        raise ValueError(
            f'Profile "{profile_name}" not found in rag_profiles and no env fallback is '
            "configured. Set EMBEDDING_PROVIDER and EMBEDDING_MODEL (and optionally "
            "VECTOR_TABLE, EMBEDDING_DIMENSIONS)."
        )
    print(
        f'Profile "{profile_name}" not found in rag_profiles — '
        f'falling back to env config (table "{settings.vector_table}").',
        file=sys.stderr,
    )
    return RagProfile(
        profile_name=profile_name,
        table_name=settings.vector_table,
        embedding_provider=settings.embedding_provider,
        embedding_model=settings.embedding_model,
        embedding_dimensions=settings.embedding_dimensions,
    )


class PgVectorStore:
    """Read-only vector search against one profile's chunk table.

    Score semantics match the importer: pgvector's ``<=>`` returns cosine
    DISTANCE, so ``score = 1 - distance`` yields cosine similarity. Results
    are ordered by distance ascending and filtered on ``score >= threshold``.
    """

    def __init__(self, conn: ConnectionLike, table_name: str) -> None:
        self._conn = conn
        self._table = quote_identifier(table_name)

    def search(
        self, query_vector: Sequence[float], limit: int, score_threshold: float = 0.0
    ) -> list[SearchHit]:
        vector_literal = to_vector_literal(query_vector)
        sql = (
            "SELECT chunk_id, content, 1 - (embedding <=> %(vec)s::vector) AS score "
            f"FROM {self._table} "
            "WHERE 1 - (embedding <=> %(vec)s::vector) >= %(threshold)s "
            "ORDER BY embedding <=> %(vec)s::vector ASC "
            "LIMIT %(limit)s"
        )
        cursor = self._conn.execute(
            sql, {"vec": vector_literal, "threshold": score_threshold, "limit": limit}
        )
        return [
            SearchHit(chunk_id=row[0], content=row[1], score=float(row[2]))
            for row in cursor.fetchall()
        ]


def to_vector_literal(vector: Sequence[float]) -> str:
    return "[" + ",".join(repr(float(v)) for v in vector) + "]"
