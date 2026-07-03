"""Ported from the TS html-chunker tests to prove behavior parity."""

from confluence_importer.chunking.html_section import HtmlSectionChunker
from confluence_importer.confluence.models import PageMetadata

chunker = HtmlSectionChunker()

DEFAULT_PARAMS = {"max_tokens": 800, "overlap_tokens": 50}


def test_returns_empty_list_for_empty_html(base_page_metadata):
    assert chunker.chunk("", base_page_metadata, DEFAULT_PARAMS) == []


def test_returns_empty_list_for_whitespace_only_html(base_page_metadata):
    assert chunker.chunk("   \n  ", base_page_metadata, DEFAULT_PARAMS) == []


def test_creates_one_chunk_for_simple_paragraph(base_page_metadata):
    html = "<p>Hello world, this is a test paragraph.</p>"
    chunks = chunker.chunk(html, base_page_metadata, DEFAULT_PARAMS)
    assert len(chunks) == 1
    assert "Hello world" in chunks[0].content


def test_splits_content_on_headers_into_separate_sections(base_page_metadata):
    html = """
      <p>Intro text</p>
      <h2>Section One</h2>
      <p>Content of section one.</p>
      <h2>Section Two</h2>
      <p>Content of section two.</p>
    """
    chunks = chunker.chunk(html, base_page_metadata, DEFAULT_PARAMS)
    assert len(chunks) >= 2
    assert any("Content of section one" in c.content for c in chunks)
    assert any("Content of section two" in c.content for c in chunks)


def test_splits_large_sections_into_multiple_chunks(base_page_metadata):
    long_paragraph = "word " * 400
    html = f"""
      <h2>Big Section</h2>
      <p>{long_paragraph}</p>
      <p>{long_paragraph}</p>
      <p>{long_paragraph}</p>
    """
    chunks = chunker.chunk(html, base_page_metadata, {"max_tokens": 200, "overlap_tokens": 50})
    assert len(chunks) > 1


def test_detects_code_content_type_for_pre_code_blocks(base_page_metadata):
    html = """
      <h2>Code Section</h2>
      <pre><code>const x = 1;\nconst y = 2;</code></pre>
    """
    chunks = chunker.chunk(html, base_page_metadata, DEFAULT_PARAMS)
    assert chunks
    assert any(c.metadata["contentType"] == "code" for c in chunks)


def test_detects_table_content_type_for_table_elements(base_page_metadata):
    html = """
      <h2>Data Table</h2>
      <table>
        <tr><th>Name</th><th>Value</th></tr>
        <tr><td>foo</td><td>bar</td></tr>
      </table>
    """
    chunks = chunker.chunk(html, base_page_metadata, DEFAULT_PARAMS)
    assert any(c.metadata["contentType"] == "table" for c in chunks)


def test_includes_page_title_in_context_prefix(base_page_metadata):
    html = "<p>Some content here.</p>"
    chunks = chunker.chunk(html, base_page_metadata, DEFAULT_PARAMS)
    assert "Test Page" in chunks[0].content


def test_includes_ancestor_path_in_context_prefix(base_page_metadata):
    metadata = base_page_metadata.model_copy(update={"ancestors": ["Parent", "Grandparent"]})
    chunks = chunker.chunk("<p>Content</p>", metadata, DEFAULT_PARAMS)
    assert "Parent" in chunks[0].content
    assert "Grandparent" in chunks[0].content


def test_assigns_sequential_chunk_indices(base_page_metadata):
    long_paragraph = "word " * 400
    html = f"""
      <p>{long_paragraph}</p>
      <p>{long_paragraph}</p>
      <p>{long_paragraph}</p>
    """
    chunks = chunker.chunk(html, base_page_metadata, {"max_tokens": 200, "overlap_tokens": 50})
    for i, chunk in enumerate(chunks):
        assert chunk.metadata["chunkIndex"] == i
        assert chunk.metadata["totalChunks"] == len(chunks)


def test_chunk_ids_follow_pageid_index_scheme(base_page_metadata):
    html = "<h2>One</h2><p>First.</p><h2>Two</h2><p>Second.</p>"
    chunks = chunker.chunk(html, base_page_metadata, DEFAULT_PARAMS)
    assert [c.id for c in chunks] == [f"page-1_{i}" for i in range(len(chunks))]


def test_header_path_appears_in_section_prefix(base_page_metadata):
    html = "<h1>Guide</h1><h2>Install</h2><p>Run the installer.</p>"
    chunks = chunker.chunk(html, base_page_metadata, DEFAULT_PARAMS)
    install_chunk = next(c for c in chunks if "Run the installer" in c.content)
    assert "Section: Guide > Install" in install_chunk.content
    assert install_chunk.metadata["headerPath"] == ["Guide", "Install"]


def test_metadata_uses_camel_case_page_fields(base_page_metadata):
    chunks = chunker.chunk("<p>Content</p>", base_page_metadata, DEFAULT_PARAMS)
    metadata = chunks[0].metadata
    assert metadata["pageId"] == "page-1"
    assert metadata["spaceKey"] == "IT"
    assert metadata["spaceName"] == "IT Space"
    assert metadata["lastModified"] == "2024-01-01T00:00:00.000Z"


def test_pre_and_table_mix_yields_mixed_content_type(base_page_metadata):
    html = """
      <pre>code here</pre>
      <table><tr><td>x</td></tr></table>
      <p>text</p>
    """
    chunks = chunker.chunk(html, base_page_metadata, DEFAULT_PARAMS)
    assert chunks[0].metadata["contentType"] == "mixed"


class TestPageMetadata:
    def test_model_copy_keeps_page_id(self, base_page_metadata: PageMetadata):
        copied = base_page_metadata.model_copy(update={"title": "Other"})
        assert copied.page_id == "page-1"
