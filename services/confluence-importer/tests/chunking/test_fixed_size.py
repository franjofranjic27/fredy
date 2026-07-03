import pytest

from confluence_importer.chunking.fixed_size import FixedSizeChunker
from confluence_importer.chunking.tokenizer import count_tokens

chunker = FixedSizeChunker()


def test_empty_html_yields_no_chunks(base_page_metadata):
    assert chunker.chunk("", base_page_metadata, {}) == []


def test_short_text_yields_single_chunk(base_page_metadata):
    chunks = chunker.chunk("<p>Short text.</p>", base_page_metadata, {})
    assert len(chunks) == 1
    assert "Short text." in chunks[0].content


def test_long_text_is_split_into_token_windows(base_page_metadata):
    html = "<p>" + "word " * 1000 + "</p>"
    chunks = chunker.chunk(html, base_page_metadata, {"max_tokens": 100, "overlap_tokens": 20})
    assert len(chunks) > 1
    # Each window respects the token limit (prefix excluded).
    prefix_tokens = count_tokens("Page: Test Page\n\n")
    for chunk in chunks:
        assert count_tokens(chunk.content) <= 100 + prefix_tokens + 5


def test_windows_overlap(base_page_metadata):
    html = "<p>" + " ".join(f"tok{i}" for i in range(300)) + "</p>"
    chunks = chunker.chunk(html, base_page_metadata, {"max_tokens": 100, "overlap_tokens": 50})
    first_body = chunks[0].content.split("\n\n", 1)[1]
    second_body = chunks[1].content.split("\n\n", 1)[1]
    # The tail of the first window reappears at the head of the second.
    assert first_body[-20:].split()[-1] in second_body


def test_rejects_overlap_greater_or_equal_max_tokens(base_page_metadata):
    with pytest.raises(ValueError, match="overlap_tokens"):
        chunker.chunk("<p>text</p>", base_page_metadata, {"max_tokens": 10, "overlap_tokens": 10})


def test_metadata_and_ids(base_page_metadata):
    chunks = chunker.chunk("<p>Some content.</p>", base_page_metadata, {})
    assert chunks[0].id == "page-1_0"
    assert chunks[0].metadata["contentType"] == "text"
    assert chunks[0].metadata["chunkIndex"] == 0
    assert chunks[0].metadata["totalChunks"] == len(chunks)
