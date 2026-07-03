"""Confluence REST API client (Cloud and Server/DC), ported from the TS implementation."""

from collections.abc import Iterator
from datetime import datetime
from typing import Any
from urllib.parse import quote

import httpx

from confluence_importer.confluence.models import (
    ConfluenceAttachment,
    ConfluenceAttachmentResult,
    ConfluencePage,
    ConfluenceSearchResult,
    PageMetadata,
)
from confluence_importer.retry import is_retryable, with_retry

_EXPAND = "body.storage,version,ancestors,metadata.labels,space"
_PAGE_SIZE = 50


class ConfluenceApiError(Exception):
    def __init__(self, status_code: int, body: str) -> None:
        super().__init__(f"Confluence API error ({status_code}): {body}")
        self.status_code = status_code


class AttachmentTooLargeError(Exception):
    def __init__(self, download_link: str, max_bytes: int) -> None:
        super().__init__(
            f"Attachment download exceeded the size cap of {max_bytes} bytes: {download_link}"
        )
        self.download_link = download_link
        self.max_bytes = max_bytes


def _cql_string(value: str) -> str:
    """Quote a value as a CQL string literal, escaping backslashes and quotes."""
    escaped = value.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escaped}"'


def _is_retryable_download(error: Exception) -> bool:
    return not isinstance(error, AttachmentTooLargeError) and is_retryable(error)


class ConfluenceClient:
    def __init__(
        self,
        base_url: str,
        username: str,
        api_token: str,
        http_client: httpx.Client | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self._http = http_client or httpx.Client(
            auth=(username, api_token),
            headers={"Accept": "application/json"},
            timeout=30.0,
        )

    def _get_json(self, endpoint: str) -> dict[str, Any]:
        def do_request() -> dict[str, Any]:
            response = self._http.get(f"{self.base_url}/rest/api{endpoint}")
            if response.status_code >= 400:
                raise ConfluenceApiError(response.status_code, response.text)
            return response.json()

        return with_retry(do_request)

    def get_pages_in_space(
        self, space_key: str, *, limit: int = _PAGE_SIZE, start: int = 0
    ) -> ConfluenceSearchResult:
        data = self._get_json(
            f"/content?spaceKey={quote(space_key)}&type=page"
            f"&expand={_EXPAND}&limit={limit}&start={start}"
        )
        return ConfluenceSearchResult.model_validate(data)

    def get_all_pages_in_space(self, space_key: str) -> Iterator[ConfluencePage]:
        """Iterate all pages in a space, following pagination."""
        start = 0
        while True:
            result = self.get_pages_in_space(space_key, limit=_PAGE_SIZE, start=start)
            yield from result.results
            if result.size < _PAGE_SIZE or not result.links.next:
                break
            start += _PAGE_SIZE

    def get_all_page_ids_in_space(self, space_key: str) -> list[str]:
        """Lightweight page-id listing (no expand) used for deletion detection."""
        ids: list[str] = []
        start = 0
        limit = 100
        while True:
            data = self._get_json(
                f"/content?spaceKey={quote(space_key)}&type=page&limit={limit}&start={start}"
            )
            result = ConfluenceSearchResult.model_validate(data)
            ids.extend(page.id for page in result.results)
            if result.size < limit or not result.links.next:
                break
            start += limit
        return ids

    def get_page(self, page_id: str) -> ConfluencePage:
        data = self._get_json(f"/content/{page_id}?expand={_EXPAND}")
        return ConfluencePage.model_validate(data)

    def get_modified_pages(self, space_key: str, since: datetime) -> list[ConfluencePage]:
        """Pages modified since a date, via CQL (date precision: day, like the TS client).

        Follows pagination so more than one page of results is returned.
        """
        cql = (
            f'space = {_cql_string(space_key)} AND type = "page" '
            f'AND lastModified >= "{since.date().isoformat()}"'
        )
        pages: list[ConfluencePage] = []
        start = 0
        limit = 100
        while True:
            data = self._get_json(
                f"/content/search?cql={quote(cql)}&expand={_EXPAND}&limit={limit}&start={start}"
            )
            result = ConfluenceSearchResult.model_validate(data)
            pages.extend(result.results)
            if result.size < limit or not result.links.next:
                break
            start += limit
        return pages

    def get_attachments(self, page_id: str) -> list[ConfluenceAttachment]:
        """All attachments of a page, following pagination."""
        attachments: list[ConfluenceAttachment] = []
        start = 0
        limit = 50
        while True:
            data = self._get_json(
                f"/content/{page_id}/child/attachment?limit={limit}&start={start}"
            )
            result = ConfluenceAttachmentResult.model_validate(data)
            attachments.extend(result.results)
            if result.size < limit or not result.links.next:
                break
            start += limit
        return attachments

    def download_attachment(self, download_link: str, max_bytes: int | None = None) -> bytes:
        """Download attachment binary data via its ``_links.download`` path.

        The body is streamed; once more than ``max_bytes`` arrive the download
        is aborted with :class:`AttachmentTooLargeError`, so the API-reported
        file size cannot be used to bypass the cap.
        """

        def do_request() -> bytes:
            with self._http.stream("GET", f"{self.base_url}{download_link}") as response:
                if response.status_code >= 400:
                    response.read()
                    raise ConfluenceApiError(response.status_code, response.text)
                content = bytearray()
                for part in response.iter_bytes():
                    content.extend(part)
                    if max_bytes is not None and len(content) > max_bytes:
                        raise AttachmentTooLargeError(download_link, max_bytes)
                return bytes(content)

        return with_retry(do_request, retryable=_is_retryable_download)

    def extract_metadata(self, page: ConfluencePage) -> PageMetadata:
        return PageMetadata(
            page_id=page.id,
            title=page.title,
            space_key=page.space.key,
            space_name=page.space.name,
            labels=page.label_names,
            author=page.version.by.display_name,
            last_modified=page.version.when,
            version=page.version.number,
            url=f"{self.base_url}{page.links.webui}",
            ancestors=[ancestor.title for ancestor in page.ancestors],
        )

    @staticmethod
    def should_include_page(
        page: ConfluencePage,
        *,
        include_labels: list[str] | None = None,
        exclude_labels: list[str] | None = None,
    ) -> bool:
        """Label filter — exclusion wins over inclusion, matching the TS behavior."""
        page_labels = page.label_names

        if exclude_labels and any(label in exclude_labels for label in page_labels):
            return False

        if include_labels:
            return any(label in include_labels for label in page_labels)

        return True
