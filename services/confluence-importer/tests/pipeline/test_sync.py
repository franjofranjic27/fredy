from datetime import UTC, datetime

from confluence_importer.pipeline.sync import sync_confluence
from tests.fakes import FakeConfluence, FakeEmbedding, FakeStore, make_page, make_profile


def test_updates_modified_pages():
    page = make_page("1")
    confluence = FakeConfluence({"IT": [page]}, modified_by_space={"IT": [page]})
    embedding = FakeEmbedding()
    store = FakeStore()

    result = sync_confluence(confluence, embedding, store, make_profile(), spaces=["IT"])

    assert result.pages_updated == 1
    assert result.chunks_created == 1
    assert store.replaced_page_ids == ["1"]  # atomic delete+insert per page
    assert len(store.upserted_chunks) == 1


def test_embeds_before_replacing_so_failures_keep_old_chunks():
    page = make_page("1")

    class ExplodingEmbedding(FakeEmbedding):
        def embed_texts(self, texts):
            raise RuntimeError("embedding down")

    confluence = FakeConfluence({"IT": [page]}, modified_by_space={"IT": [page]})
    store = FakeStore()

    result = sync_confluence(confluence, ExplodingEmbedding(), store, make_profile(), spaces=["IT"])

    # Embedding failed before any store mutation: the old chunks survive.
    assert result.pages_updated == 0
    assert store.replaced_page_ids == []
    assert store.deleted_page_ids == []


def test_registers_profile_on_sync():
    store = FakeStore()
    profile = make_profile("exp1")

    sync_confluence(FakeConfluence({"IT": []}), FakeEmbedding(), store, profile, spaces=["IT"])

    assert store.upserted_profiles == [profile]


def test_deletes_pages_excluded_by_label():
    page = make_page("1", labels=["draft"])
    confluence = FakeConfluence({"IT": [page]}, modified_by_space={"IT": [page]})
    store = FakeStore()

    result = sync_confluence(
        confluence,
        FakeEmbedding(),
        store,
        make_profile(),
        spaces=["IT"],
        exclude_labels=["draft"],
    )

    assert result.pages_deleted == 1
    assert result.pages_updated == 0
    assert store.deleted_page_ids == ["1"]
    assert store.upserted == []


def test_deletes_stale_pages_missing_in_confluence():
    confluence = FakeConfluence({"IT": [make_page("1")]}, modified_by_space={"IT": []})
    store = FakeStore()
    store.stored_pages = {"1": "IT", "gone-1": "IT", "local_abc123": "IT"}

    result = sync_confluence(confluence, FakeEmbedding(), store, make_profile(), spaces=["IT"])

    # "gone-1" no longer exists in Confluence; local file ids are never touched.
    assert result.pages_deleted == 1
    assert store.deleted_page_ids == ["gone-1"]


def test_stale_deletion_is_scoped_to_configured_spaces():
    """Regression: removing a space from CONFLUENCE_SPACES must not delete its pages."""
    confluence = FakeConfluence({"IT": [make_page("it-1")]}, modified_by_space={"IT": []})
    store = FakeStore()
    store.stored_pages = {"it-1": "IT", "it-gone": "IT", "hr-1": "HR", "hr-2": "HR"}

    result = sync_confluence(confluence, FakeEmbedding(), store, make_profile(), spaces=["IT"])

    # Only the stale IT page is deleted; HR pages survive although HR is not synced.
    assert result.pages_deleted == 1
    assert store.deleted_page_ids == ["it-gone"]


def test_survives_page_level_errors():
    page = make_page("1")

    class ExplodingStore(FakeStore):
        def replace_page_chunks(self, page_id, chunks, embeddings):
            raise RuntimeError("db down")

    confluence = FakeConfluence({"IT": [page]}, modified_by_space={"IT": [page]})
    result = sync_confluence(
        confluence, FakeEmbedding(), ExplodingStore(), make_profile(), spaces=["IT"]
    )

    assert result.pages_updated == 0


def test_default_window_is_last_24_hours():
    calls: list[datetime] = []

    class RecordingConfluence(FakeConfluence):
        def get_modified_pages(self, space_key, since):
            calls.append(since)
            return []

    confluence = RecordingConfluence({"IT": []})
    sync_confluence(confluence, FakeEmbedding(), FakeStore(), make_profile(), spaces=["IT"])

    delta = datetime.now(UTC) - calls[0]
    assert 23.9 < delta.total_seconds() / 3600 < 24.1
