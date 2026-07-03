import pytest

from confluence_importer.confluence.models import PageMetadata

ENV_KEYS = [
    "CONFLUENCE_BASE_URL",
    "CONFLUENCE_USERNAME",
    "CONFLUENCE_API_TOKEN",
    "CONFLUENCE_SPACES",
    "CONFLUENCE_INCLUDE_LABELS",
    "CONFLUENCE_EXCLUDE_LABELS",
    "EMBEDDING_PROVIDER",
    "EMBEDDING_API_KEY",
    "EMBEDDING_MODEL",
    "EMBEDDING_DIMENSIONS",
    "DATABASE_URL",
    "CHUNKS_TABLE",
    "SYNC_CRON",
    "SYNC_FULL_ON_START",
    "CHUNK_MAX_TOKENS",
    "CHUNK_OVERLAP_TOKENS",
    "CHUNK_PRESERVE_CODE",
    "CHUNK_PRESERVE_TABLES",
    "LOCAL_FILES_ENABLED",
    "LOCAL_FILES_DIRECTORY",
    "LOCAL_FILES_EXTENSIONS",
    "PROFILES_FILE",
    "MEDIA_ENABLED",
    "MEDIA_CAPTION_ENABLED",
    "MEDIA_MAX_BYTES",
    "ANTHROPIC_API_KEY",
    "LOG_LEVEL",
]


@pytest.fixture
def clean_env(monkeypatch: pytest.MonkeyPatch) -> pytest.MonkeyPatch:
    """Remove all importer env vars so tests control the environment fully."""
    for key in ENV_KEYS:
        monkeypatch.delenv(key, raising=False)
    return monkeypatch


@pytest.fixture
def base_page_metadata() -> PageMetadata:
    return PageMetadata(
        page_id="page-1",
        title="Test Page",
        space_key="IT",
        space_name="IT Space",
        labels=[],
        author="test-user",
        last_modified="2024-01-01T00:00:00.000Z",
        version=1,
        url="https://example.com/wiki/page-1",
        ancestors=[],
    )
