import logging
from typing import Any

from rag_eval.generator.models import SampledChunk, SampledChunkMetadata
from rag_eval.generator.rng import SeededRng
from rag_eval.store.pgvector import ConnectionLike, quote_identifier

logger = logging.getLogger(__name__)


class PgVectorSampler:
    """Read-only sampler over one profile's chunk table.

    Sampling happens DB-side with ``ORDER BY random()``: Postgres samples
    across the whole table in one round trip. The seed is pushed to Postgres
    via ``setseed`` (derived from the mulberry32 RNG), so the ``--seed``
    reproducibility contract holds against the same corpus.
    """

    def __init__(self, conn: ConnectionLike, table_name: str) -> None:
        self._conn = conn
        self._table = quote_identifier(table_name)

    def sample_chunks(
        self, n: int, rng: SeededRng, space_key: str | None = None
    ) -> list[SampledChunk]:
        self._conn.execute("SELECT setseed(%s)", (derive_seed(rng),))

        params: list[Any] = []
        where = ""
        if space_key is not None:
            params.append(space_key)
            where = "WHERE space_key = %s "
        params.append(n)

        cursor = self._conn.execute(
            "SELECT chunk_id, page_id, space_key, title, content, metadata "
            f"FROM {self._table} {where}ORDER BY random() LIMIT %s",
            params,
        )
        chunks = _map_rows(cursor.fetchall())
        if len(chunks) < n:
            logger.warning(
                "Sampled only %d of %d requested chunks (table too small, "
                "space filter too narrow, or rows with unusable metadata)",
                len(chunks),
                n,
            )
        return chunks

    def get_chunks_by_page_id(self, page_id: str) -> list[SampledChunk]:
        """Return all chunks of a page, in chunk index order."""
        cursor = self._conn.execute(
            "SELECT chunk_id, page_id, space_key, title, content, metadata "
            f"FROM {self._table} WHERE page_id = %s",
            (page_id,),
        )
        chunks = _map_rows(cursor.fetchall())
        return sorted(chunks, key=lambda c: c.metadata.chunk_index)


def derive_seed(rng: SeededRng) -> float:
    """Map an RNG draw into the [-1, 1] range Postgres' ``setseed`` expects."""
    return rng.next() * 2 - 1


def _map_rows(rows: list[tuple[Any, ...]]) -> list[SampledChunk]:
    chunks = [_to_sampled_chunk(row) for row in rows]
    return [chunk for chunk in chunks if chunk is not None]


def _to_sampled_chunk(row: tuple[Any, ...]) -> SampledChunk | None:
    """Map a row to a SampledChunk; rows with an invalid shape are dropped.

    ``space_key`` and ``title`` are nullable columns: NULL values are mapped
    to an empty string instead of dropping the row.
    """
    chunk_id, page_id, space_key, title, content, metadata = row
    metadata = metadata or {}
    chunk_index = metadata.get("chunkIndex")
    total_chunks = metadata.get("totalChunks")
    title = title if title is not None else ""
    space_key = space_key if space_key is not None else ""

    if (
        not isinstance(chunk_id, str)
        or not isinstance(page_id, str)
        or not isinstance(content, str)
        or not isinstance(title, str)
        or not isinstance(space_key, str)
        or not isinstance(chunk_index, int)
        or not isinstance(total_chunks, int)
    ):
        return None

    raw_header_path = metadata.get("headerPath")
    header_path = (
        tuple(entry for entry in raw_header_path if isinstance(entry, str))
        if isinstance(raw_header_path, list)
        else ()
    )
    raw_space_name = metadata.get("spaceName")
    space_name = raw_space_name if isinstance(raw_space_name, str) else None

    return SampledChunk(
        chunk_id=chunk_id,
        page_id=page_id,
        content=content,
        metadata=SampledChunkMetadata(
            title=title,
            space_key=space_key,
            space_name=space_name,
            header_path=header_path,
            chunk_index=chunk_index,
            total_chunks=total_chunks,
        ),
    )
