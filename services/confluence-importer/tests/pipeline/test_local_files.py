from pathlib import Path

from confluence_importer.pipeline.local_files import (
    LocalFileClient,
    ingest_local_files,
    local_file_to_html,
)
from tests.fakes import FakeEmbedding, FakeStore, make_profile


class TestLocalFileToHtml:
    def test_html_passes_through(self):
        assert local_file_to_html("<p>hi</p>", ".html") == "<p>hi</p>"

    def test_markdown_headers_and_paragraphs(self):
        html = local_file_to_html("# Title\n\nSome text", ".md")
        assert "<h1>Title</h1>" in html
        assert "<p>Some text</p>" in html

    def test_markdown_fenced_code_blocks(self):
        html = local_file_to_html("```\nconst x = 1;\n```", ".md")
        assert "<pre><code>const x = 1;</code></pre>" in html

    def test_markdown_unclosed_code_block(self):
        html = local_file_to_html("```\ndangling code", ".md")
        assert "<pre><code>dangling code</code></pre>" in html

    def test_markdown_escapes_html(self):
        html = local_file_to_html("uses <b>bold</b>", ".md")
        assert "&lt;b&gt;bold&lt;/b&gt;" in html

    def test_text_paragraphs(self):
        html = local_file_to_html("first para\n\nsecond para", ".txt")
        assert html == "<p>first para</p>\n<p>second para</p>"

    def test_unknown_extension_treated_as_text(self):
        assert local_file_to_html("plain", ".rst") == "<p>plain</p>"


class TestLocalFileClient:
    def test_scans_matching_files_recursively(self, tmp_path: Path):
        (tmp_path / "a.md").write_text("# A")
        (tmp_path / "sub").mkdir()
        (tmp_path / "sub" / "b.txt").write_text("B")
        (tmp_path / "sub" / "ignored.pdf").write_text("PDF")

        client = LocalFileClient(str(tmp_path), [".md", ".txt"])
        files = list(client.get_all_files())

        assert sorted(f.relative_path for f in files) == ["a.md", "sub/b.txt"]

    def test_missing_directory_yields_nothing(self, tmp_path: Path):
        client = LocalFileClient(str(tmp_path / "nope"), [".md"])
        assert list(client.get_all_files()) == []

    def test_extract_metadata_is_stable_and_compatible(self, tmp_path: Path):
        (tmp_path / "docs").mkdir()
        (tmp_path / "docs" / "guide.md").write_text("# G")
        client = LocalFileClient(str(tmp_path), [".md"])
        file = next(iter(client.get_all_files()))

        metadata = client.extract_metadata(file)
        metadata_again = client.extract_metadata(file)

        assert metadata.page_id.startswith("local_")
        assert len(metadata.page_id) == len("local_") + 12
        assert metadata.page_id == metadata_again.page_id
        assert metadata.title == "guide"
        assert metadata.space_key == "local"
        assert metadata.ancestors == ["docs"]
        assert metadata.url.startswith("file://")


class TestIngestLocalFiles:
    def test_ingests_files_into_store(self, tmp_path: Path):
        (tmp_path / "one.md").write_text("# One\n\ncontent one")
        (tmp_path / "two.txt").write_text("content two")
        client = LocalFileClient(str(tmp_path), [".md", ".txt"])
        embedding = FakeEmbedding()
        store = FakeStore()

        result = ingest_local_files(client, embedding, store, make_profile())

        assert result.files_processed == 2
        assert result.chunks_created == len(store.upserted_chunks)
        assert result.errors == []
        assert store.schema_initialized
        assert len(store.replaced_page_ids) == 2

    def test_collects_errors_per_file(self, tmp_path: Path):
        (tmp_path / "bad.md").write_text("# Bad\n\nsome content")

        class ExplodingStore(FakeStore):
            def replace_page_chunks(self, page_id, chunks, embeddings) -> None:
                raise RuntimeError("nope")

        client = LocalFileClient(str(tmp_path), [".md"])
        store = ExplodingStore()
        # batch_size=1 forces the flush inside the per-file try block,
        # so the failure is attributed to the file that triggered it.
        result = ingest_local_files(client, FakeEmbedding(), store, make_profile(), batch_size=1)

        assert result.errors == [("bad.md", "nope")]
        assert store.upserted == []  # replace failed, nothing was stored

    def test_files_are_replaced_atomically_not_deleted_upfront(self, tmp_path: Path):
        (tmp_path / "doc.md").write_text("# Doc\n\ntext")
        store = FakeStore()

        ingest_local_files(
            LocalFileClient(str(tmp_path), [".md"]), FakeEmbedding(), store, make_profile()
        )

        assert store.deleted_page_ids == []
        assert len(store.replaced_page_ids) == 1
