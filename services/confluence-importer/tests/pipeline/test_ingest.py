from confluence_importer.pipeline.ingest import ingest_confluence
from tests.fakes import FakeConfluence, FakeEmbedding, FakeStore, make_page, make_profile


def test_ingests_pages_and_stores_chunks():
    confluence = FakeConfluence({"IT": [make_page("1"), make_page("2")]})
    embedding = FakeEmbedding()
    store = FakeStore()

    result = ingest_confluence(confluence, embedding, store, make_profile(), spaces=["IT"])

    assert result.pages_processed == 2
    assert result.chunks_created == 2
    assert result.errors == []
    assert store.schema_initialized
    assert store.replaced_page_ids == ["1", "2"]  # atomic delete+insert per page
    assert len(store.upserted_chunks) == 2


def test_registers_profile_on_ingest():
    store = FakeStore()
    profile = make_profile("exp1")
    ingest_confluence(FakeConfluence({"IT": []}), FakeEmbedding(), store, profile, spaces=["IT"])
    assert store.upserted_profiles == [profile]


def test_skips_pages_by_exclude_label():
    confluence = FakeConfluence({"IT": [make_page("1", labels=["draft"]), make_page("2")]})
    store = FakeStore()

    result = ingest_confluence(
        confluence,
        FakeEmbedding(),
        store,
        make_profile(),
        spaces=["IT"],
        exclude_labels=["draft"],
    )

    assert result.pages_processed == 1
    assert result.pages_skipped == 1
    assert store.replaced_page_ids == ["2"]


def test_flushes_buffer_in_batches():
    body = "".join(f"<h2>S{i}</h2><p>Content {i}</p>" for i in range(3))
    pages = [make_page(str(page_id), body=body) for page_id in range(1, 4)]
    confluence = FakeConfluence({"IT": pages})
    embedding = FakeEmbedding()
    store = FakeStore()

    result = ingest_confluence(
        confluence, embedding, store, make_profile(), spaces=["IT"], batch_size=4
    )

    assert result.chunks_created == 9
    # Pages are buffered whole: pages 1+2 (6 chunks >= 4) flush together,
    # page 3 flushes at the end of the space.
    assert [len(batch) for batch in embedding.embedded_batches] == [6, 3]
    assert store.replaced_page_ids == ["1", "2", "3"]
    assert len(store.upserted_chunks) == result.chunks_created


def test_replaces_empty_pages_to_clear_stale_chunks():
    confluence = FakeConfluence({"IT": [make_page("1", body="")]})
    store = FakeStore()
    embedding = FakeEmbedding()

    result = ingest_confluence(confluence, embedding, store, make_profile(), spaces=["IT"])

    # A page without chunks still gets replaced so previously stored chunks vanish.
    assert result.pages_processed == 1
    assert result.chunks_created == 0
    assert store.replaced_page_ids == ["1"]
    assert embedding.embedded_batches == []


def test_collects_errors_per_page():
    class ExplodingStore(FakeStore):
        def replace_page_chunks(self, page_id, chunks, embeddings):
            if page_id == "1":
                raise RuntimeError("boom")
            super().replace_page_chunks(page_id, chunks, embeddings)

    confluence = FakeConfluence({"IT": [make_page("1"), make_page("2")]})
    store = ExplodingStore()

    result = ingest_confluence(
        confluence, FakeEmbedding(), store, make_profile(), spaces=["IT"], batch_size=1
    )

    assert result.pages_processed == 1
    assert result.errors == [("1", "boom")]
    assert store.replaced_page_ids == ["2"]


def test_uses_profile_chunker():
    confluence = FakeConfluence({"IT": [make_page("1")]})
    store = FakeStore()
    profile = make_profile("fixed", chunker="fixed_size")

    result = ingest_confluence(confluence, FakeEmbedding(), store, profile, spaces=["IT"])

    assert result.chunks_created == 1
    assert store.upserted_chunks[0].metadata["contentType"] == "text"
