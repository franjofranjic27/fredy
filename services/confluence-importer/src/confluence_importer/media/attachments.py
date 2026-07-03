"""Image attachment ingestion: download, store, optionally caption and embed.

Image attachments (Anthropic-supported types, size ≤ MEDIA_MAX_BYTES) are
stored in the ``attachments`` table. When captioning is enabled, a dense
factual description is generated via the Anthropic Messages API and embedded
as an extra chunk in the profile's chunks table
(chunk_id ``{page_id}_att_{attachment_id}``).
"""

import base64
import logging
from dataclasses import dataclass

import httpx

from confluence_importer.chunking.base import Chunk
from confluence_importer.confluence.client import (
    AttachmentTooLargeError,
    ConfluenceClient,
)
from confluence_importer.confluence.models import ConfluenceAttachment, PageMetadata
from confluence_importer.embeddings.base import EmbeddingProvider
from confluence_importer.retry import with_retry
from confluence_importer.store.pgvector import PgVectorStore

logger = logging.getLogger(__name__)

# Image types the Anthropic Messages API accepts for vision input.
_SUPPORTED_IMAGE_MEDIA_TYPES = frozenset({"image/jpeg", "image/png", "image/gif", "image/webp"})

_ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1"
_ANTHROPIC_VERSION = "2023-06-01"
_CAPTION_MODEL = "claude-haiku-4-5-20251001"
_CAPTION_MAX_TOKENS = 1024

_CAPTION_PROMPT = (
    "Describe this image from the Confluence page {title!r} as a dense, factual "
    "description for a search index. Include all visible text, labels, numbers, "
    "diagram structure and relationships. Write in the same language as the page "
    "content. Do not speculate beyond what is visible."
)


class CaptionApiError(Exception):
    def __init__(self, status_code: int, body: str) -> None:
        super().__init__(f"Anthropic caption request failed ({status_code}): {body}")
        self.status_code = status_code


class AnthropicCaptioner:
    """Caption images via the Anthropic Messages API."""

    def __init__(
        self,
        api_key: str,
        model: str = _CAPTION_MODEL,
        http_client: httpx.Client | None = None,
    ) -> None:
        self.model = model
        self._http = http_client or httpx.Client(
            headers={
                "x-api-key": api_key,
                "anthropic-version": _ANTHROPIC_VERSION,
            },
            timeout=120.0,
        )

    def caption(self, image_data: bytes, media_type: str, page_title: str) -> str:
        payload = {
            "model": self.model,
            "max_tokens": _CAPTION_MAX_TOKENS,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": media_type,
                                "data": base64.b64encode(image_data).decode("ascii"),
                            },
                        },
                        {"type": "text", "text": _CAPTION_PROMPT.format(title=page_title)},
                    ],
                }
            ],
        }

        def do_request() -> str:
            response = self._http.post(f"{_ANTHROPIC_BASE_URL}/messages", json=payload)
            if response.status_code >= 400:
                raise CaptionApiError(response.status_code, response.text)
            blocks = response.json()["content"]
            return "\n".join(block["text"] for block in blocks if block.get("type") == "text")

        return with_retry(do_request)


@dataclass(frozen=True)
class AttachmentIngestResult:
    attachments_stored: int
    captions_embedded: int


class AttachmentIngestor:
    """Ingest image attachments of a page into the attachments table."""

    def __init__(
        self,
        confluence: ConfluenceClient,
        store: PgVectorStore,
        *,
        max_bytes: int = 5_000_000,
        captioner: AnthropicCaptioner | None = None,
        embedding: EmbeddingProvider | None = None,
    ) -> None:
        self._confluence = confluence
        self._store = store
        self._max_bytes = max_bytes
        self._captioner = captioner
        self._embedding = embedding

    def ingest_page_attachments(self, page_metadata: PageMetadata) -> AttachmentIngestResult:
        stored = 0
        captions = 0

        for attachment in self._confluence.get_attachments(page_metadata.page_id):
            if not self._is_ingestible(attachment):
                continue
            try:
                captioned = self._ingest_attachment(attachment, page_metadata)
                stored += 1
                captions += int(captioned)
            except AttachmentTooLargeError:
                logger.warning(
                    "Skipping attachment %s (%s): download exceeded the size cap of %d bytes",
                    attachment.id,
                    attachment.title,
                    self._max_bytes,
                )
            except Exception:
                logger.exception(
                    "Failed to ingest attachment %s (%s)", attachment.id, attachment.title
                )

        return AttachmentIngestResult(attachments_stored=stored, captions_embedded=captions)

    def _is_ingestible(self, attachment: ConfluenceAttachment) -> bool:
        if attachment.media_type not in _SUPPORTED_IMAGE_MEDIA_TYPES:
            logger.debug(
                "Skipping attachment %s (unsupported media type %s)",
                attachment.title,
                attachment.media_type,
            )
            return False
        if attachment.file_size > self._max_bytes:
            logger.debug(
                "Skipping oversized attachment %s (%d bytes)",
                attachment.title,
                attachment.file_size,
            )
            return False
        return True

    def _ingest_attachment(
        self, attachment: ConfluenceAttachment, page_metadata: PageMetadata
    ) -> bool:
        # The API-reported file size can be missing or wrong; the client
        # enforces the cap on the actual downloaded bytes.
        data = self._confluence.download_attachment(
            attachment.links.download, max_bytes=self._max_bytes
        )
        url = f"{self._confluence.base_url}{attachment.links.download}"

        caption: str | None = None
        if self._captioner is not None:
            caption = self._captioner.caption(data, attachment.media_type, page_metadata.title)

        self._store.upsert_attachment(
            attachment_id=attachment.id,
            page_id=page_metadata.page_id,
            filename=attachment.title,
            media_type=attachment.media_type,
            file_size=attachment.file_size,
            url=url,
            data=data,
            caption=caption,
        )

        if caption and self._embedding is not None:
            self._embed_caption(attachment, page_metadata, caption)
            return True
        return False

    def _embed_caption(
        self,
        attachment: ConfluenceAttachment,
        page_metadata: PageMetadata,
        caption: str,
    ) -> None:
        content = f"Page: {page_metadata.title}\nImage: {attachment.title}\n\n{caption}"
        metadata = page_metadata.to_metadata_dict()
        metadata.update(contentType="image", attachmentId=attachment.id)
        chunk = Chunk(
            id=f"{page_metadata.page_id}_att_{attachment.id}",
            content=content,
            metadata=metadata,
        )
        embeddings = self._embedding.embed_texts([chunk.content])
        self._store.upsert_chunks([chunk], embeddings)
