"""Shared HTML → markdown-ish text converter, ported from the TS html-chunker.

Conversion rules:
- ``<pre>``/``<code>`` blocks → fenced ``` blocks (inline code → backticks)
- ``<table>`` → markdown pipe rows with a separator after the header row
- ``<li>`` → bullet lines
- ``<h1>``-``<h6>`` → ``#`` markers
"""

import re

from bs4 import BeautifulSoup, Comment, NavigableString, Tag
from bs4.element import PageElement

_HEADER_RE = re.compile(r"^h[1-6]$")


def convert_table_to_text(table: Tag) -> str:
    rows: list[list[str]] = []
    for row in table.find_all("tr"):
        cells = row.find_all(["th", "td"])
        rows.append([cell.get_text().strip() for cell in cells])

    if not rows:
        return ""

    lines = [f"| {' | '.join(row)} |" for row in rows]
    if len(lines) > 1:
        separator = f"| {' | '.join('---' for _ in rows[0])} |"
        lines.insert(1, separator)

    return "\n" + "\n".join(lines) + "\n\n"


def node_to_text(node: PageElement) -> str:
    """Extract text content from a single HTML node, preserving structure hints."""
    if isinstance(node, Comment):
        return ""
    if isinstance(node, NavigableString):
        return str(node).strip()
    if not isinstance(node, Tag):
        return ""

    tag = node.name.lower()

    if tag == "br":
        return "\n"
    if tag == "hr":
        return "\n---\n"

    if tag in ("pre", "code"):
        code = node.get_text().strip()
        parent_tag = node.parent.name.lower() if isinstance(node.parent, Tag) else ""
        if tag == "pre" or parent_tag == "pre":
            return f"\n```\n{code}\n```\n"
        return f"`{code}`"

    if tag == "table":
        return convert_table_to_text(node)

    if tag == "li":
        content = "".join(node_to_text(child) for child in node.children)
        return f"• {content}\n"

    if tag in ("p", "div"):
        content = "".join(node_to_text(child) for child in node.children)
        return f"{content}\n\n" if content else ""

    if _HEADER_RE.match(tag):
        level = int(tag[1])
        content = "".join(node_to_text(child) for child in node.children)
        return f"\n{'#' * level} {content}\n\n"

    return "".join(node_to_text(child) for child in node.children)


def parse_fragment(html: str) -> list[PageElement]:
    """Parse an HTML fragment and return its top-level nodes."""
    soup = BeautifulSoup(html, "lxml")
    root = soup.body or soup
    return list(root.children)


def html_to_text(html: str) -> str:
    """Convert a whole HTML document/fragment to markdown-ish plain text."""
    return "".join(node_to_text(node) for node in parse_fragment(html))
