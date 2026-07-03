from confluence_importer.chunking.recursive import RecursiveChunker

chunker = RecursiveChunker()


def test_empty_html_yields_no_chunks(base_page_metadata):
    assert chunker.chunk("", base_page_metadata, {}) == []


def test_short_text_yields_single_chunk(base_page_metadata):
    chunks = chunker.chunk("<p>Short text.</p>", base_page_metadata, {})
    assert len(chunks) == 1
    assert "Short text." in chunks[0].content


def test_long_text_is_split_by_character_budget(base_page_metadata):
    html = "".join(f"<p>Paragraph number {i} with some words.</p>" for i in range(200))
    chunks = chunker.chunk(html, base_page_metadata, {"chunk_size": 500, "chunk_overlap": 50})
    assert len(chunks) > 1
    prefix_len = len("Page: Test Page\n\n")
    for chunk in chunks:
        assert len(chunk.content) <= 500 + prefix_len


def test_context_prefix_and_metadata(base_page_metadata):
    chunks = chunker.chunk("<p>Content here.</p>", base_page_metadata, {})
    assert chunks[0].content.startswith("Page: Test Page\n\n")
    assert chunks[0].id == "page-1_0"
    assert chunks[0].metadata["contentType"] == "text"
    assert chunks[0].metadata["totalChunks"] == 1
