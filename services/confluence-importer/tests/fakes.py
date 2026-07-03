"""Shared test doubles for store, embeddings and Confluence."""

from contextlib import contextmanager
from typing import Any

from confluence_importer.chunking.base import Chunk
from confluence_importer.confluence.models import ConfluencePage, PageMetadata
from confluence_importer.profiles import RagProfile


class FakeCursor:
    def __init__(self, executed: list[tuple[str, Any]], rows: list[Any]) -> None:
        self._executed = executed
        self._rows = rows

    def execute(self, sql: str, params: Any = None) -> "FakeCursor":
        self._executed.append((sql, params))
        return self

    def executemany(self, sql: str, rows: Any) -> "FakeCursor":
        self._executed.append((sql, list(rows)))
        return self

    def fetchall(self) -> list[Any]:
        return self._rows

    def fetchone(self) -> Any:
        return self._rows[0] if self._rows else None

    def __enter__(self) -> "FakeCursor":
        return self

    def __exit__(self, *args: object) -> bool:
        return False


class FakeConnection:
    def __init__(self, executed: list[tuple[str, Any]], results: list[list[Any]]) -> None:
        self._executed = executed
        self._results = results

    def _next_rows(self) -> list[Any]:
        return self._results.pop(0) if self._results else []

    def execute(self, sql: str, params: Any = None) -> FakeCursor:
        cursor = FakeCursor(self._executed, self._next_rows())
        cursor.execute(sql, params)
        return cursor

    def cursor(self) -> FakeCursor:
        return FakeCursor(self._executed, self._next_rows())

    @contextmanager
    def transaction(self):
        self._executed.append(("BEGIN", None))
        yield
        self._executed.append(("COMMIT", None))


class FakePool:
    """Duck-typed psycopg_pool.ConnectionPool for SQL-assertion tests."""

    def __init__(self) -> None:
        self.executed: list[tuple[str, Any]] = []
        self.results: list[list[Any]] = []
        self.closed = False

    @contextmanager
    def connection(self):
        yield FakeConnection(self.executed, self.results)

    def close(self) -> None:
        self.closed = True

    @property
    def statements(self) -> list[str]:
        return [sql for sql, _ in self.executed]


class FakeEmbedding:
    model = "fake-model"
    dimensions = 3

    def __init__(self) -> None:
        self.embedded_batches: list[list[str]] = []

    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        self.embedded_batches.append(list(texts))
        return [[0.1, 0.2, 0.3] for _ in texts]

    def embed_query(self, text: str) -> list[float]:
        return self.embed_texts([text])[0]


class FakeStore:
    def __init__(self) -> None:
        self.schema_initialized = False
        self.attachments_schema_initialized = False
        self.upserted_profiles: list[RagProfile] = []
        self.upserted: list[tuple[list[Chunk], list[list[float]]]] = []
        self.replaced_page_ids: list[str] = []
        self.deleted_page_ids: list[str] = []
        self.stored_pages: dict[str, str | None] = {}  # page_id -> space_key
        self.attachments: list[dict[str, Any]] = []
        self.truncated = False

    def init_schema(self) -> None:
        self.schema_initialized = True

    def init_attachments_schema(self) -> None:
        self.attachments_schema_initialized = True

    def upsert_profile(self, profile: RagProfile) -> None:
        self.upserted_profiles.append(profile)

    def upsert_chunks(self, chunks: list[Chunk], embeddings: list[list[float]]) -> None:
        self.upserted.append((list(chunks), list(embeddings)))

    def replace_page_chunks(
        self, page_id: str, chunks: list[Chunk], embeddings: list[list[float]]
    ) -> None:
        self.replaced_page_ids.append(page_id)
        self.upserted.append((list(chunks), list(embeddings)))

    def delete_page_chunks(self, page_id: str) -> None:
        self.deleted_page_ids.append(page_id)

    def list_stored_page_ids(self, space_key: str | None = None) -> list[str]:
        if space_key is None:
            return list(self.stored_pages)
        return [pid for pid, space in self.stored_pages.items() if space == space_key]

    def truncate(self) -> None:
        self.truncated = True

    def upsert_attachment(self, **kwargs: Any) -> None:
        self.attachments.append(kwargs)

    @property
    def upserted_chunks(self) -> list[Chunk]:
        return [chunk for chunks, _ in self.upserted for chunk in chunks]


class FakeConfluence:
    """Duck-typed ConfluenceClient backed by in-memory pages."""

    base_url = "https://example.atlassian.net/wiki"

    def __init__(
        self,
        pages_by_space: dict[str, list[ConfluencePage]],
        modified_by_space: dict[str, list[ConfluencePage]] | None = None,
    ) -> None:
        self._pages_by_space = pages_by_space
        self._modified_by_space = modified_by_space or {}

    def get_all_pages_in_space(self, space_key: str):
        yield from self._pages_by_space.get(space_key, [])

    def get_all_page_ids_in_space(self, space_key: str) -> list[str]:
        return [page.id for page in self._pages_by_space.get(space_key, [])]

    def get_modified_pages(self, space_key: str, since) -> list[ConfluencePage]:
        return self._modified_by_space.get(space_key, [])

    def extract_metadata(self, page: ConfluencePage) -> PageMetadata:
        return PageMetadata(
            page_id=page.id,
            title=page.title,
            space_key=page.space.key,
            space_name=page.space.name,
            labels=page.label_names,
            author=page.version.by.display_name,
            last_modified=page.version.when,
            version=page.version.number,
            url=f"{self.base_url}{page.links.webui}",
            ancestors=[ancestor.title for ancestor in page.ancestors],
        )

    @staticmethod
    def should_include_page(page: ConfluencePage, **kwargs: Any) -> bool:
        from confluence_importer.confluence.client import ConfluenceClient

        return ConfluenceClient.should_include_page(page, **kwargs)


def make_page(
    page_id: str = "1",
    title: str = "Test Page",
    labels: list[str] | None = None,
    body: str = "<p>content</p>",
) -> ConfluencePage:
    return ConfluencePage.model_validate(
        {
            "id": page_id,
            "type": "page",
            "status": "current",
            "title": title,
            "space": {"key": "IT", "name": "IT Space"},
            "body": {"storage": {"value": body, "representation": "storage"}},
            "version": {
                "number": 1,
                "when": "2024-01-01T00:00:00.000Z",
                "by": {"displayName": "Test User"},
            },
            "ancestors": [],
            "metadata": {
                "labels": {"results": [{"name": name, "prefix": "global"} for name in labels or []]}
            },
            "_links": {"webui": f"/wiki/page/{page_id}", "self": ""},
        }
    )


def make_profile(name: str = "default", chunker: str = "html_section") -> RagProfile:
    return RagProfile(
        name=name,
        chunker=chunker,
        chunker_params={"max_tokens": 800, "overlap_tokens": 100},
        embedding_provider="openai",
        embedding_model="text-embedding-3-small",
        embedding_dimensions=1536,
        table_name="chunks" if name == "default" else f"chunks_{name}",
    )
