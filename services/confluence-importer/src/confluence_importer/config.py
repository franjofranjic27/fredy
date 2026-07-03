"""Environment configuration. Env variable names are identical to the former TS service."""

from typing import Literal

from pydantic import BaseModel, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from confluence_importer.confluence.url_validator import validate_confluence_base_url

EmbeddingProviderName = Literal["openai", "voyage", "cohere"]
LogLevel = Literal["debug", "info", "warn", "error"]


def _split_csv(value: str | None) -> list[str]:
    if not value:
        return []
    return [item for item in value.split(",") if item]


class _EnvSettings(BaseSettings):
    """Flat view of the process environment. One field per env variable."""

    model_config = SettingsConfigDict(case_sensitive=False, extra="ignore")

    confluence_base_url: str | None = None
    confluence_username: str | None = None
    confluence_api_token: str | None = None
    confluence_spaces: str | None = None
    confluence_include_labels: str | None = None
    confluence_exclude_labels: str | None = None

    embedding_provider: EmbeddingProviderName = "openai"
    embedding_api_key: str = ""
    embedding_model: str = "text-embedding-3-small"
    embedding_dimensions: int = 1536

    database_url: str = "postgresql://fredy:fredy@localhost:5432/fredy"
    chunks_table: str = "chunks"

    sync_cron: str = "0 */6 * * *"
    sync_full_on_start: bool = False

    chunk_max_tokens: int = 800
    chunk_overlap_tokens: int = 100
    chunk_preserve_code: bool = True
    chunk_preserve_tables: bool = True

    local_files_enabled: bool = False
    local_files_directory: str = "/data/files"
    local_files_extensions: str = ".md,.txt,.html"

    profiles_file: str | None = None

    media_enabled: bool = False
    media_caption_enabled: bool = False
    media_max_bytes: int = 5_000_000
    anthropic_api_key: str | None = None

    log_level: LogLevel = "info"


class ConfluenceConfig(BaseModel):
    base_url: str
    username: str
    api_token: str
    spaces: list[str] = Field(min_length=1)
    include_labels: list[str] | None = None
    exclude_labels: list[str] = ["ignore", "draft", "archived"]

    @field_validator("base_url")
    @classmethod
    def _validate_base_url(cls, value: str) -> str:
        result = validate_confluence_base_url(value)
        if not result.ok:
            raise ValueError(" ".join(result.errors))
        return value


class EmbeddingConfig(BaseModel):
    provider: EmbeddingProviderName
    api_key: str
    model: str = "text-embedding-3-small"
    dimensions: int = 1536


class DatabaseConfig(BaseModel):
    url: str = "postgresql://fredy:fredy@localhost:5432/fredy"
    table: str = "chunks"


class ChunkingConfig(BaseModel):
    max_tokens: int = 800
    overlap_tokens: int = 100
    preserve_code_blocks: bool = True
    preserve_tables: bool = True


class SyncConfig(BaseModel):
    cron_schedule: str = "0 */6 * * *"
    full_sync_on_start: bool = False


class LocalFilesConfig(BaseModel):
    enabled: bool = False
    directory: str = "/data/files"
    extensions: list[str] = [".md", ".txt", ".html"]


class MediaConfig(BaseModel):
    enabled: bool = False
    caption_enabled: bool = False
    max_bytes: int = 5_000_000
    anthropic_api_key: str | None = None


class Config(BaseModel):
    confluence: ConfluenceConfig | None = None
    embedding: EmbeddingConfig
    database: DatabaseConfig = DatabaseConfig()
    chunking: ChunkingConfig = ChunkingConfig()
    sync: SyncConfig = SyncConfig()
    local_files: LocalFilesConfig = LocalFilesConfig()
    media: MediaConfig = MediaConfig()
    profiles_file: str | None = None
    log_level: LogLevel = "info"


def load_config() -> Config:
    """Build the structured config from the process environment (fail fast on bad input)."""
    env = _EnvSettings()

    confluence: ConfluenceConfig | None = None
    if env.confluence_base_url:
        confluence = ConfluenceConfig(
            base_url=env.confluence_base_url,
            username=env.confluence_username or "",
            api_token=env.confluence_api_token or "",
            spaces=_split_csv(env.confluence_spaces),
            include_labels=_split_csv(env.confluence_include_labels) or None,
            exclude_labels=(
                _split_csv(env.confluence_exclude_labels) or ["ignore", "draft", "archived"]
            ),
        )

    return Config(
        confluence=confluence,
        embedding=EmbeddingConfig(
            provider=env.embedding_provider,
            api_key=env.embedding_api_key,
            model=env.embedding_model,
            dimensions=env.embedding_dimensions,
        ),
        database=DatabaseConfig(url=env.database_url, table=env.chunks_table),
        chunking=ChunkingConfig(
            max_tokens=env.chunk_max_tokens,
            overlap_tokens=env.chunk_overlap_tokens,
            preserve_code_blocks=env.chunk_preserve_code,
            preserve_tables=env.chunk_preserve_tables,
        ),
        sync=SyncConfig(
            cron_schedule=env.sync_cron,
            full_sync_on_start=env.sync_full_on_start,
        ),
        local_files=LocalFilesConfig(
            enabled=env.local_files_enabled,
            directory=env.local_files_directory,
            extensions=_split_csv(env.local_files_extensions) or [".md", ".txt", ".html"],
        ),
        media=MediaConfig(
            enabled=env.media_enabled,
            caption_enabled=env.media_caption_enabled,
            max_bytes=env.media_max_bytes,
            anthropic_api_key=env.anthropic_api_key,
        ),
        profiles_file=env.profiles_file,
        log_level=env.log_level,
    )
