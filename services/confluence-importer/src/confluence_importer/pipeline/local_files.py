"""Local file ingestion (.md/.txt/.html) — files are converted to HTML and reuse
the profile's chunking pipeline, exactly like the former TS implementation."""

import hashlib
import html
import logging
import re
from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

from confluence_importer.chunking.base import get_chunker
from confluence_importer.confluence.models import PageMetadata
from confluence_importer.embeddings.base import EmbeddingProvider
from confluence_importer.pipeline.chunk_batch import PageChunks, flush_page_buffer
from confluence_importer.profiles import RagProfile
from confluence_importer.store.pgvector import PgVectorStore

logger = logging.getLogger(__name__)

_DEFAULT_BATCH_SIZE = 10
_MD_HEADER_RE = re.compile(r"^(#{1,6})\s+(.+)$")


@dataclass(frozen=True)
class LocalFile:
    file_path: Path
    relative_path: str
    file_name: str
    extension: str
    content: str
    modified_at: datetime


class LocalFileClient:
    def __init__(self, directory: str, extensions: list[str]) -> None:
        self._directory = Path(directory)
        self._extensions = {ext.lower() for ext in extensions}

    def get_all_files(self) -> Iterator[LocalFile]:
        """Recursively scan the directory and yield matching files."""
        if not self._directory.is_dir():
            return
        for path in sorted(self._directory.rglob("*")):
            if not path.is_file() or path.suffix.lower() not in self._extensions:
                continue
            try:
                content = path.read_text(encoding="utf-8")
                modified_at = datetime.fromtimestamp(path.stat().st_mtime, tz=UTC)
            except OSError:
                continue  # Skip files that can't be read
            yield LocalFile(
                file_path=path,
                relative_path=str(path.relative_to(self._directory)),
                file_name=path.stem,
                extension=path.suffix.lower(),
                content=content,
                modified_at=modified_at,
            )

    def extract_metadata(self, file: LocalFile) -> PageMetadata:
        """PageMetadata for a local file (compatible with the Confluence pipeline)."""
        path_hash = hashlib.md5(  # noqa: S324 - stable id, not security
            file.relative_path.encode("utf-8")
        ).hexdigest()[:12]

        parts = file.relative_path.split("/")
        ancestors = parts[:-1] if len(parts) > 1 else []

        return PageMetadata(
            page_id=f"local_{path_hash}",
            title=file.file_name,
            space_key="local",
            space_name="Local Files",
            labels=[],
            author="local",
            last_modified=file.modified_at.isoformat(),
            version=1,
            url=f"file://{file.file_path}",
            ancestors=ancestors,
        )


def local_file_to_html(content: str, extension: str) -> str:
    """Convert local file content to HTML so the chunkers can process it."""
    match extension.lower():
        case ".html":
            return content
        case ".md":
            return _markdown_to_html(content)
        case _:
            return _text_to_html(content)


def _markdown_to_html(md: str) -> str:
    """Lightweight markdown-to-HTML: headers, paragraphs, fenced code blocks."""
    html_parts: list[str] = []
    in_code_block = False
    code_buffer: list[str] = []

    for line in md.split("\n"):
        if line.startswith("```"):
            if in_code_block:
                html_parts.append(
                    f"<pre><code>{html.escape('\n'.join(code_buffer), quote=False)}</code></pre>"
                )
                code_buffer = []
                in_code_block = False
            else:
                in_code_block = True
            continue

        if in_code_block:
            code_buffer.append(line)
            continue

        header_match = _MD_HEADER_RE.match(line)
        if header_match:
            level = len(header_match.group(1))
            html_parts.append(
                f"<h{level}>{html.escape(header_match.group(2), quote=False)}</h{level}>"
            )
            continue

        if not line.strip():
            continue

        html_parts.append(f"<p>{html.escape(line, quote=False)}</p>")

    if in_code_block and code_buffer:
        html_parts.append(
            f"<pre><code>{html.escape('\n'.join(code_buffer), quote=False)}</code></pre>"
        )

    return "\n".join(html_parts)


def _text_to_html(text: str) -> str:
    paragraphs = [p.strip() for p in re.split(r"\n\n+", text) if p.strip()]
    return "\n".join(f"<p>{html.escape(p, quote=False)}</p>" for p in paragraphs)


@dataclass
class IngestLocalResult:
    files_processed: int = 0
    chunks_created: int = 0
    errors: list[tuple[str, str]] = field(default_factory=list)  # (file_path, error)


def ingest_local_files(
    local_files: LocalFileClient,
    embedding: EmbeddingProvider,
    store: PgVectorStore,
    profile: RagProfile,
    *,
    batch_size: int = _DEFAULT_BATCH_SIZE,
) -> IngestLocalResult:
    result = IngestLocalResult()

    store.init_schema()
    store.upsert_profile(profile)
    chunker = get_chunker(profile.chunker)

    logger.info("Processing local files")
    buffer: list[PageChunks] = []

    for file in local_files.get_all_files():
        try:
            logger.info("Processing file: %s", file.relative_path)
            metadata = local_files.extract_metadata(file)
            html_content = local_file_to_html(file.content, file.extension)
            chunks = chunker.chunk(html_content, metadata, profile.chunker_params)
            logger.debug("Chunks created for %s: %d", file.relative_path, len(chunks))

            buffer.append((metadata.page_id, chunks))
            result.files_processed += 1
            result.chunks_created += len(chunks)

            if sum(len(file_chunks) for _, file_chunks in buffer) >= batch_size:
                flush_page_buffer(buffer, embedding, store)
        except Exception as error:
            logger.error("Failed to process file %s: %s", file.relative_path, error)
            result.errors.append((file.relative_path, str(error)))

    flush_page_buffer(buffer, embedding, store)

    return result
