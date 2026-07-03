import base64
import json

import pytest

from confluence_importer.confluence.client import AttachmentTooLargeError
from confluence_importer.confluence.models import ConfluenceAttachment
from confluence_importer.media.attachments import AnthropicCaptioner, AttachmentIngestor
from tests.fakes import FakeEmbedding, FakeStore


class FakeAttachmentConfluence:
    base_url = "https://example.atlassian.net/wiki"

    def __init__(self, attachments: list[ConfluenceAttachment], data: bytes = b"img") -> None:
        self._attachments = attachments
        self._data = data
        self.downloaded: list[str] = []
        self.download_caps: list[int | None] = []

    def get_attachments(self, page_id: str) -> list[ConfluenceAttachment]:
        return self._attachments

    def download_attachment(self, download_link: str, max_bytes: int | None = None) -> bytes:
        self.downloaded.append(download_link)
        self.download_caps.append(max_bytes)
        if max_bytes is not None and len(self._data) > max_bytes:
            raise AttachmentTooLargeError(download_link, max_bytes)
        return self._data


class FakeCaptioner:
    def __init__(self, text: str = "A caption") -> None:
        self.text = text
        self.calls: list[tuple[bytes, str, str]] = []

    def caption(self, image_data: bytes, media_type: str, page_title: str) -> str:
        self.calls.append((image_data, media_type, page_title))
        return self.text


def make_attachment(
    attachment_id: str = "att1",
    media_type: str = "image/png",
    file_size: int = 1000,
) -> ConfluenceAttachment:
    return ConfluenceAttachment.model_validate(
        {
            "id": attachment_id,
            "title": "diagram.png",
            "extensions": {"mediaType": media_type, "fileSize": file_size},
            "_links": {"download": f"/download/attachments/1/{attachment_id}.png"},
        }
    )


class TestAttachmentIngestor:
    def test_stores_image_attachments(self, base_page_metadata):
        confluence = FakeAttachmentConfluence([make_attachment()])
        store = FakeStore()
        ingestor = AttachmentIngestor(confluence, store)

        result = ingestor.ingest_page_attachments(base_page_metadata)

        assert result.attachments_stored == 1
        assert result.captions_embedded == 0
        stored = store.attachments[0]
        assert stored["attachment_id"] == "att1"
        assert stored["page_id"] == "page-1"
        assert stored["media_type"] == "image/png"
        assert stored["data"] == b"img"
        assert stored["caption"] is None

    def test_skips_non_image_attachments(self, base_page_metadata):
        confluence = FakeAttachmentConfluence([make_attachment(media_type="application/pdf")])
        store = FakeStore()
        result = AttachmentIngestor(confluence, store).ingest_page_attachments(base_page_metadata)
        assert result.attachments_stored == 0
        assert confluence.downloaded == []

    @pytest.mark.parametrize("media_type", ["image/svg+xml", "image/tiff", "image/bmp"])
    def test_skips_image_types_outside_the_allowlist(self, base_page_metadata, media_type):
        confluence = FakeAttachmentConfluence([make_attachment(media_type=media_type)])
        store = FakeStore()
        result = AttachmentIngestor(confluence, store).ingest_page_attachments(base_page_metadata)
        assert result.attachments_stored == 0
        assert confluence.downloaded == []

    @pytest.mark.parametrize("media_type", ["image/jpeg", "image/png", "image/gif", "image/webp"])
    def test_ingests_all_allowlisted_image_types(self, base_page_metadata, media_type):
        confluence = FakeAttachmentConfluence([make_attachment(media_type=media_type)])
        store = FakeStore()
        result = AttachmentIngestor(confluence, store).ingest_page_attachments(base_page_metadata)
        assert result.attachments_stored == 1

    def test_skips_oversized_attachments(self, base_page_metadata):
        confluence = FakeAttachmentConfluence([make_attachment(file_size=10_000_000)])
        store = FakeStore()
        result = AttachmentIngestor(confluence, store, max_bytes=5_000_000).ingest_page_attachments(
            base_page_metadata
        )
        assert result.attachments_stored == 0

    def test_passes_size_cap_to_the_download(self, base_page_metadata):
        confluence = FakeAttachmentConfluence([make_attachment()])
        store = FakeStore()
        AttachmentIngestor(confluence, store, max_bytes=1234).ingest_page_attachments(
            base_page_metadata
        )
        assert confluence.download_caps == [1234]

    def test_skips_attachment_whose_actual_size_exceeds_the_cap(self, base_page_metadata, caplog):
        # API reports a small file_size, but the downloaded body is larger.
        confluence = FakeAttachmentConfluence([make_attachment(file_size=10)], data=b"x" * 100)
        store = FakeStore()

        with caplog.at_level("WARNING"):
            result = AttachmentIngestor(confluence, store, max_bytes=50).ingest_page_attachments(
                base_page_metadata
            )

        assert result.attachments_stored == 0
        assert store.attachments == []
        assert "exceeded the size cap" in caplog.text

    def test_captions_and_embeds_when_enabled(self, base_page_metadata):
        confluence = FakeAttachmentConfluence([make_attachment()])
        store = FakeStore()
        embedding = FakeEmbedding()
        captioner = FakeCaptioner("A flowchart of the deploy process")

        result = AttachmentIngestor(
            confluence, store, captioner=captioner, embedding=embedding
        ).ingest_page_attachments(base_page_metadata)

        assert result.captions_embedded == 1
        assert store.attachments[0]["caption"] == "A flowchart of the deploy process"
        assert captioner.calls[0][1] == "image/png"
        assert captioner.calls[0][2] == "Test Page"

        chunk = store.upserted_chunks[0]
        assert chunk.id == "page-1_att_att1"
        assert chunk.metadata["contentType"] == "image"
        assert chunk.metadata["attachmentId"] == "att1"
        assert "A flowchart of the deploy process" in chunk.content
        assert "Test Page" in chunk.content

    def test_continues_after_single_attachment_failure(self, base_page_metadata):
        class FailingConfluence(FakeAttachmentConfluence):
            def download_attachment(
                self, download_link: str, max_bytes: int | None = None
            ) -> bytes:
                if "att1" in download_link:
                    raise RuntimeError("download failed")
                return super().download_attachment(download_link, max_bytes=max_bytes)

        confluence = FailingConfluence([make_attachment("att1"), make_attachment("att2")])
        store = FakeStore()
        result = AttachmentIngestor(confluence, store).ingest_page_attachments(base_page_metadata)
        assert result.attachments_stored == 1
        assert store.attachments[0]["attachment_id"] == "att2"


class TestAnthropicCaptioner:
    def test_sends_image_as_base64_block(self, httpx_mock):
        httpx_mock.add_response(json={"content": [{"type": "text", "text": "Dense description"}]})
        captioner = AnthropicCaptioner(api_key="sk-ant-test")

        caption = captioner.caption(b"image-bytes", "image/png", "My Page")

        assert caption == "Dense description"
        request = httpx_mock.get_requests()[0]
        assert request.url == "https://api.anthropic.com/v1/messages"
        assert request.headers["x-api-key"] == "sk-ant-test"
        assert request.headers["anthropic-version"] == "2023-06-01"

        payload = json.loads(request.content)
        assert payload["model"] == "claude-haiku-4-5-20251001"
        image_block = payload["messages"][0]["content"][0]
        assert image_block["type"] == "image"
        assert image_block["source"]["media_type"] == "image/png"
        assert base64.b64decode(image_block["source"]["data"]) == b"image-bytes"
        text_block = payload["messages"][0]["content"][1]
        assert "My Page" in text_block["text"]

    def test_raises_on_api_error(self, httpx_mock):
        httpx_mock.add_response(status_code=400, text="invalid request")
        captioner = AnthropicCaptioner(api_key="sk-ant-test")
        with pytest.raises(Exception, match=r"\(400\)"):
            captioner.caption(b"x", "image/png", "Page")
