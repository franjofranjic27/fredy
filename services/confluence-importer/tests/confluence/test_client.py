import pytest

from confluence_importer.confluence.client import (
    AttachmentTooLargeError,
    ConfluenceApiError,
    ConfluenceClient,
)
from tests.fakes import make_page


@pytest.fixture
def client() -> ConfluenceClient:
    return ConfluenceClient(
        base_url="https://example.atlassian.net/wiki",
        username="test@example.com",
        api_token="test-token",
    )


def _page_json(page_id: str, title: str = "Page") -> dict:
    return {
        "id": page_id,
        "type": "page",
        "status": "current",
        "title": title,
        "space": {"key": "IT", "name": "IT Space"},
        "body": {"storage": {"value": "<p>content</p>", "representation": "storage"}},
        "version": {
            "number": 3,
            "when": "2024-01-01T00:00:00.000Z",
            "by": {"displayName": "Test User"},
        },
        "ancestors": [{"id": "0", "title": "Root"}],
        "metadata": {"labels": {"results": [{"name": "tech", "prefix": "global"}]}},
        "_links": {"webui": f"/wiki/page/{page_id}", "self": ""},
    }


class TestShouldIncludePage:
    def test_includes_page_when_no_filters_set(self):
        assert ConfluenceClient.should_include_page(make_page(labels=[]))

    def test_excludes_page_with_excluded_label(self):
        page = make_page(labels=["draft", "important"])
        assert not ConfluenceClient.should_include_page(page, exclude_labels=["draft", "archived"])

    def test_includes_page_with_required_include_label(self):
        page = make_page(labels=["published", "tech"])
        assert ConfluenceClient.should_include_page(page, include_labels=["published"])

    def test_excludes_page_without_any_include_label(self):
        page = make_page(labels=["tech"])
        assert not ConfluenceClient.should_include_page(
            page, include_labels=["published", "approved"]
        )

    def test_exclude_takes_priority_over_include(self):
        page = make_page(labels=["published", "draft"])
        assert not ConfluenceClient.should_include_page(
            page, include_labels=["published"], exclude_labels=["draft"]
        )


class TestRestEndpoints:
    def test_get_pages_in_space_hits_content_endpoint(self, client, httpx_mock):
        httpx_mock.add_response(
            json={"results": [_page_json("1")], "start": 0, "limit": 50, "size": 1, "_links": {}}
        )
        result = client.get_pages_in_space("IT")

        request = httpx_mock.get_requests()[0]
        assert request.url.path == "/wiki/rest/api/content"
        assert request.url.params["spaceKey"] == "IT"
        assert request.url.params["type"] == "page"
        assert request.url.params["limit"] == "50"
        assert request.url.params["start"] == "0"
        assert "body.storage" in request.url.params["expand"]
        assert result.results[0].id == "1"

    def test_get_all_pages_paginates_until_no_next_link(self, client, httpx_mock):
        first_batch = [_page_json(str(i)) for i in range(50)]
        httpx_mock.add_response(
            json={
                "results": first_batch,
                "start": 0,
                "limit": 50,
                "size": 50,
                "_links": {"next": "/rest/api/content?start=50"},
            }
        )
        httpx_mock.add_response(
            json={"results": [_page_json("50")], "start": 50, "limit": 50, "size": 1, "_links": {}}
        )

        pages = list(client.get_all_pages_in_space("IT"))
        assert len(pages) == 51
        assert httpx_mock.get_requests()[1].url.params["start"] == "50"

    def test_get_page_by_id(self, client, httpx_mock):
        httpx_mock.add_response(json=_page_json("42", title="Answer"))
        page = client.get_page("42")
        assert page.title == "Answer"
        assert httpx_mock.get_requests()[0].url.path == "/wiki/rest/api/content/42"

    def test_get_modified_pages_uses_cql(self, client, httpx_mock):
        from datetime import datetime

        httpx_mock.add_response(json={"results": [_page_json("7")], "size": 1, "_links": {}})
        pages = client.get_modified_pages("IT", datetime(2024, 5, 1, 12, 30))

        request = httpx_mock.get_requests()[0]
        assert request.url.path == "/wiki/rest/api/content/search"
        cql = request.url.params["cql"]
        assert 'space = "IT"' in cql
        assert 'lastModified >= "2024-05-01"' in cql
        assert len(pages) == 1

    def test_get_modified_pages_paginates_until_exhausted(self, client, httpx_mock):
        from datetime import datetime

        first_batch = [_page_json(str(i)) for i in range(100)]
        httpx_mock.add_response(
            json={
                "results": first_batch,
                "size": 100,
                "_links": {"next": "/rest/api/content/search?start=100"},
            }
        )
        httpx_mock.add_response(json={"results": [_page_json("100")], "size": 1, "_links": {}})

        pages = client.get_modified_pages("IT", datetime(2024, 5, 1))

        assert len(pages) == 101
        requests = httpx_mock.get_requests()
        assert requests[0].url.params["start"] == "0"
        assert requests[1].url.params["start"] == "100"

    def test_get_modified_pages_escapes_cql_literals(self, client, httpx_mock):
        from datetime import datetime

        httpx_mock.add_response(json={"results": [], "size": 0, "_links": {}})
        client.get_modified_pages('IT" OR space != "', datetime(2024, 5, 1))

        cql = httpx_mock.get_requests()[0].url.params["cql"]
        # Embedded quotes must not break out of the CQL string literal.
        assert 'space = "IT\\" OR space != \\""' in cql

    def test_get_modified_pages_escapes_backslashes_in_cql(self, client, httpx_mock):
        from datetime import datetime

        httpx_mock.add_response(json={"results": [], "size": 0, "_links": {}})
        client.get_modified_pages('IT\\"', datetime(2024, 5, 1))

        cql = httpx_mock.get_requests()[0].url.params["cql"]
        assert 'space = "IT\\\\\\""' in cql

    def test_get_all_page_ids_in_space(self, client, httpx_mock):
        httpx_mock.add_response(
            json={
                "results": [{"id": "1", "title": "A"}, {"id": "2", "title": "B"}],
                "size": 2,
                "_links": {},
            }
        )
        assert client.get_all_page_ids_in_space("IT") == ["1", "2"]

    def test_get_attachments(self, client, httpx_mock):
        httpx_mock.add_response(
            json={
                "results": [
                    {
                        "id": "att1",
                        "title": "diagram.png",
                        "extensions": {"mediaType": "image/png", "fileSize": 1234},
                        "_links": {"download": "/download/attachments/1/diagram.png"},
                    }
                ],
                "size": 1,
                "_links": {},
            }
        )
        attachments = client.get_attachments("1")
        assert attachments[0].media_type == "image/png"
        assert attachments[0].file_size == 1234
        assert httpx_mock.get_requests()[0].url.path == (
            "/wiki/rest/api/content/1/child/attachment"
        )

    def test_download_attachment(self, client, httpx_mock):
        httpx_mock.add_response(content=b"\x89PNG...")
        data = client.download_attachment("/download/attachments/1/diagram.png")
        assert data == b"\x89PNG..."

    def test_download_attachment_accepts_body_within_cap(self, client, httpx_mock):
        httpx_mock.add_response(content=b"1234")
        data = client.download_attachment("/download/attachments/1/small.png", max_bytes=4)
        assert data == b"1234"

    def test_download_attachment_aborts_when_body_exceeds_cap(self, client, httpx_mock):
        # API-reported size is irrelevant: the actual streamed bytes are counted.
        httpx_mock.add_response(content=b"x" * 100)
        with pytest.raises(AttachmentTooLargeError, match="size cap of 10 bytes"):
            client.download_attachment("/download/attachments/1/huge.png", max_bytes=10)

    def test_download_attachment_size_abort_is_not_retried(self, client, httpx_mock):
        httpx_mock.add_response(content=b"x" * 100)
        with pytest.raises(AttachmentTooLargeError):
            client.download_attachment("/download/attachments/1/huge.png", max_bytes=10)
        assert len(httpx_mock.get_requests()) == 1

    def test_download_attachment_raises_api_error(self, client, httpx_mock):
        httpx_mock.add_response(status_code=403, text="forbidden")
        with pytest.raises(ConfluenceApiError, match=r"\(403\)"):
            client.download_attachment("/download/attachments/1/secret.png")

    def test_raises_confluence_api_error_on_http_error(self, client, httpx_mock):
        httpx_mock.add_response(status_code=404, text="Not found")
        with pytest.raises(ConfluenceApiError, match=r"\(404\)"):
            client.get_page("missing")


class TestExtractMetadata:
    def test_maps_all_fields(self, client):
        page = make_page("9", title="My Page", labels=["tech"])
        metadata = client.extract_metadata(page)
        assert metadata.page_id == "9"
        assert metadata.title == "My Page"
        assert metadata.space_key == "IT"
        assert metadata.space_name == "IT Space"
        assert metadata.labels == ["tech"]
        assert metadata.author == "Test User"
        assert metadata.version == 1
        assert metadata.url == "https://example.atlassian.net/wiki/wiki/page/9"
        assert metadata.ancestors == []
