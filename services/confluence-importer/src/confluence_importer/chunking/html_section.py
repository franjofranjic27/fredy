"""Header-section chunking strategy — the default, ported 1:1 from the TS html-chunker.

Splits HTML by ``<h1>``-``<h6>`` into sections carrying a header-path stack, then
splits oversized sections by paragraphs with sentence-boundary overlap.
"""

import re
from collections.abc import Mapping
from dataclasses import dataclass, replace
from typing import Any

from bs4 import Comment, NavigableString, Tag

from confluence_importer.chunking.base import (
    Chunk,
    build_chunk_metadata,
    build_context_prefix,
)
from confluence_importer.chunking.html_to_text import node_to_text, parse_fragment
from confluence_importer.chunking.tokenizer import count_tokens
from confluence_importer.confluence.models import PageMetadata

_HEADER_RE = re.compile(r"^h[1-6]$")
_SENTENCE_BOUNDARY_RE = re.compile(r"^[^.!?]*[.!?]\s*")
_WORD_BOUNDARY_RE = re.compile(r"^\S*\s+")
_PARAGRAPH_SPLIT_RE = re.compile(r"\n\n+")


@dataclass(frozen=True)
class _Section:
    header_path: list[str]
    content: str
    content_type: str  # text | code | table | mixed


def _next_content_type(current: str, tag: str) -> str:
    if tag in ("pre", "code"):
        if current == "text":
            return "code"
        if current != "code":
            return "mixed"
    elif tag == "table":
        if current == "text":
            return "table"
        if current != "table":
            return "mixed"
    return current


def _split_by_headers(html: str) -> list[_Section]:
    sections: list[_Section] = []
    header_stack: list[str] = []
    current_path: list[str] = []
    current_content = ""
    current_type = "text"

    def flush() -> None:
        nonlocal current_content
        if current_content.strip():
            sections.append(_Section(list(current_path), current_content, current_type))

    for node in parse_fragment(html):
        if isinstance(node, Comment):
            continue
        if isinstance(node, NavigableString):
            if str(node).strip():
                current_content += str(node)
            continue
        if not isinstance(node, Tag):
            continue

        tag = node.name.lower()

        if _HEADER_RE.match(tag):
            flush()
            level = int(tag[1])
            header_text = node.get_text().strip()
            while len(header_stack) >= level:
                header_stack.pop()
            header_stack.append(header_text)
            current_path = list(header_stack)
            current_content = ""
            current_type = "text"
            continue

        current_type = _next_content_type(current_type, tag)
        current_content += node_to_text(node)

    flush()
    return sections


def _get_overlap_text(content: str, overlap_tokens: int) -> str:
    """Take ~overlap_tokens worth of trailing text, snapped to a sentence/word boundary."""
    target_chars = overlap_tokens * 4
    if len(content) <= target_chars:
        return content

    text = content[len(content) - target_chars :]

    sentence_match = _SENTENCE_BOUNDARY_RE.match(text)
    if sentence_match:
        return text[sentence_match.end() :]

    word_match = _WORD_BOUNDARY_RE.match(text)
    if word_match:
        return text[word_match.end() :]

    return text


def _split_section(section: _Section, max_tokens: int, overlap_tokens: int) -> list[_Section]:
    if count_tokens(section.content) <= max_tokens:
        return [section]

    paragraphs = _PARAGRAPH_SPLIT_RE.split(section.content)
    chunks: list[_Section] = []
    current_chunk = ""
    current_tokens = 0

    for para in paragraphs:
        para_tokens = count_tokens(para)

        if current_tokens + para_tokens > max_tokens and current_chunk:
            chunks.append(replace(section, content=current_chunk.strip()))
            overlap_text = _get_overlap_text(current_chunk, overlap_tokens)
            current_chunk = overlap_text + para + "\n\n"
            current_tokens = count_tokens(current_chunk)
        else:
            current_chunk += para + "\n\n"
            current_tokens += para_tokens

    if current_chunk.strip():
        chunks.append(replace(section, content=current_chunk.strip()))

    return chunks


class HtmlSectionChunker:
    name = "html_section"

    def chunk(self, html: str, page: PageMetadata, params: Mapping[str, Any]) -> list[Chunk]:
        max_tokens = int(params.get("max_tokens", 800))
        overlap_tokens = int(params.get("overlap_tokens", 100))

        sections: list[_Section] = []
        for section in _split_by_headers(html):
            sections.extend(_split_section(section, max_tokens, overlap_tokens))

        if not sections:
            return []

        total = len(sections)
        return [
            Chunk(
                id=f"{page.page_id}_{index}",
                content=build_context_prefix(page, section.header_path) + section.content.strip(),
                metadata=build_chunk_metadata(
                    page,
                    chunk_index=index,
                    total_chunks=total,
                    header_path=section.header_path,
                    content_type=section.content_type,
                ),
            )
            for index, section in enumerate(sections)
        ]
