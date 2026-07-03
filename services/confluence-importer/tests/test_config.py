import pytest
from pydantic import ValidationError

from confluence_importer.config import load_config

BASE_ENV = {
    "EMBEDDING_PROVIDER": "openai",
    "EMBEDDING_API_KEY": "test-key",
    "EMBEDDING_MODEL": "text-embedding-3-small",
}


@pytest.fixture
def env(clean_env):
    for key, value in BASE_ENV.items():
        clean_env.setenv(key, value)
    return clean_env


def test_loads_minimal_config_without_confluence(env):
    config = load_config()
    assert config.confluence is None
    assert config.embedding.provider == "openai"
    assert config.embedding.api_key == "test-key"


def test_applies_embedding_defaults(env):
    assert load_config().embedding.dimensions == 1536


def test_overrides_embedding_dimensions(env):
    env.setenv("EMBEDDING_DIMENSIONS", "768")
    assert load_config().embedding.dimensions == 768


def test_applies_database_defaults(env):
    config = load_config()
    assert config.database.url == "postgresql://fredy:fredy@localhost:5432/fredy"
    assert config.database.table == "chunks"


def test_applies_chunking_defaults(env):
    config = load_config()
    assert config.chunking.max_tokens == 800
    assert config.chunking.overlap_tokens == 100
    assert config.chunking.preserve_code_blocks is True
    assert config.chunking.preserve_tables is True


def test_disables_preserve_flags(env):
    env.setenv("CHUNK_PRESERVE_CODE", "false")
    env.setenv("CHUNK_PRESERVE_TABLES", "false")
    config = load_config()
    assert config.chunking.preserve_code_blocks is False
    assert config.chunking.preserve_tables is False


def test_applies_sync_defaults(env):
    config = load_config()
    assert config.sync.cron_schedule == "0 */6 * * *"
    assert config.sync.full_sync_on_start is False


def test_parses_confluence_config(env):
    env.setenv("CONFLUENCE_BASE_URL", "https://example.atlassian.net/wiki")
    env.setenv("CONFLUENCE_USERNAME", "user@example.com")
    env.setenv("CONFLUENCE_API_TOKEN", "token")
    env.setenv("CONFLUENCE_SPACES", "IT,DOCS")
    config = load_config()
    assert config.confluence is not None
    assert config.confluence.spaces == ["IT", "DOCS"]
    assert config.confluence.exclude_labels == ["ignore", "draft", "archived"]
    assert config.confluence.include_labels is None


def test_parses_label_filters(env):
    env.setenv("CONFLUENCE_BASE_URL", "https://example.atlassian.net/wiki")
    env.setenv("CONFLUENCE_USERNAME", "user@example.com")
    env.setenv("CONFLUENCE_API_TOKEN", "token")
    env.setenv("CONFLUENCE_SPACES", "IT")
    env.setenv("CONFLUENCE_INCLUDE_LABELS", "published,tech")
    env.setenv("CONFLUENCE_EXCLUDE_LABELS", "wip")
    config = load_config()
    assert config.confluence.include_labels == ["published", "tech"]
    assert config.confluence.exclude_labels == ["wip"]


def test_rejects_invalid_confluence_base_url(env):
    env.setenv("CONFLUENCE_BASE_URL", "https://example.atlassian.net")
    env.setenv("CONFLUENCE_USERNAME", "user@example.com")
    env.setenv("CONFLUENCE_API_TOKEN", "token")
    env.setenv("CONFLUENCE_SPACES", "IT")
    with pytest.raises(ValidationError, match="/wiki"):
        load_config()


def test_requires_at_least_one_space_when_confluence_configured(env):
    env.setenv("CONFLUENCE_BASE_URL", "https://example.atlassian.net/wiki")
    env.setenv("CONFLUENCE_USERNAME", "user@example.com")
    env.setenv("CONFLUENCE_API_TOKEN", "token")
    with pytest.raises(ValidationError):
        load_config()


def test_local_files_defaults(env):
    config = load_config()
    assert config.local_files.enabled is False
    assert config.local_files.directory == "/data/files"
    assert config.local_files.extensions == [".md", ".txt", ".html"]


def test_local_files_overrides(env):
    env.setenv("LOCAL_FILES_ENABLED", "true")
    env.setenv("LOCAL_FILES_DIRECTORY", "/tmp/docs")
    env.setenv("LOCAL_FILES_EXTENSIONS", ".md,.rst")
    config = load_config()
    assert config.local_files.enabled is True
    assert config.local_files.directory == "/tmp/docs"
    assert config.local_files.extensions == [".md", ".rst"]


def test_media_defaults(env):
    config = load_config()
    assert config.media.enabled is False
    assert config.media.caption_enabled is False
    assert config.media.max_bytes == 5_000_000
    assert config.media.anthropic_api_key is None


def test_media_overrides(env):
    env.setenv("MEDIA_ENABLED", "true")
    env.setenv("MEDIA_CAPTION_ENABLED", "true")
    env.setenv("MEDIA_MAX_BYTES", "1000000")
    env.setenv("ANTHROPIC_API_KEY", "sk-ant-test")
    config = load_config()
    assert config.media.enabled is True
    assert config.media.caption_enabled is True
    assert config.media.max_bytes == 1_000_000
    assert config.media.anthropic_api_key == "sk-ant-test"


def test_profiles_file_env(env):
    env.setenv("PROFILES_FILE", "/etc/fredy/profiles.yaml")
    assert load_config().profiles_file == "/etc/fredy/profiles.yaml"


def test_log_level(env):
    env.setenv("LOG_LEVEL", "debug")
    assert load_config().log_level == "debug"
