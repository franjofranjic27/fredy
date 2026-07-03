import pytest

from confluence_importer.confluence.url_validator import validate_confluence_base_url


def test_accepts_valid_cloud_url():
    result = validate_confluence_base_url("https://example.atlassian.net/wiki")
    assert result.ok
    assert result.errors == []


def test_accepts_valid_server_url():
    assert validate_confluence_base_url("https://confluence.example.com").ok


def test_rejects_unparseable_url():
    result = validate_confluence_base_url("not a url")
    assert not result.ok
    assert "not a valid URL" in result.errors[0]


def test_rejects_non_http_scheme():
    result = validate_confluence_base_url("ftp://example.atlassian.net/wiki")
    assert not result.ok
    assert any("http(s)" in error for error in result.errors)


@pytest.mark.parametrize(
    "url",
    [
        "https://example.atlassian.net/wiki/rest/api",
        "https://example.atlassian.net/wiki/spaces/IT",
        "https://example.atlassian.net/wiki/display/IT",
        "https://confluence.example.com/pages/viewpage",
        "https://confluence.example.com/display/IT/Page",
    ],
)
def test_rejects_urls_pointing_below_the_root(url):
    result = validate_confluence_base_url(url)
    assert not result.ok
    assert any("must point at the Confluence root" in error for error in result.errors)


def test_rejects_cloud_url_missing_wiki_suffix():
    result = validate_confluence_base_url("https://example.atlassian.net")
    assert not result.ok
    assert any('must end in "/wiki"' in error for error in result.errors)


def test_rejects_atlassian_com_hostname():
    result = validate_confluence_base_url("https://example.atlassian.com/wiki")
    assert not result.ok
    assert any("atlassian.net" in error for error in result.errors)


def test_trailing_slash_is_tolerated_on_cloud():
    assert validate_confluence_base_url("https://example.atlassian.net/wiki/").ok
