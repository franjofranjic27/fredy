import pytest
from typer.testing import CliRunner

from confluence_importer import cli
from confluence_importer.pipeline.ingest import IngestResult
from confluence_importer.pipeline.sync import SyncResult
from tests.fakes import FakeStore

runner = CliRunner()

BASE_ENV = {
    "EMBEDDING_PROVIDER": "openai",
    "EMBEDDING_API_KEY": "test-key",
    "EMBEDDING_MODEL": "text-embedding-3-small",
}

CONFLUENCE_ENV = {
    "CONFLUENCE_BASE_URL": "https://example.atlassian.net/wiki",
    "CONFLUENCE_USERNAME": "user@example.com",
    "CONFLUENCE_API_TOKEN": "token",
    "CONFLUENCE_SPACES": "IT",
}


@pytest.fixture
def env(clean_env):
    for key, value in BASE_ENV.items():
        clean_env.setenv(key, value)
    return clean_env


@pytest.fixture
def store(env, monkeypatch) -> FakeStore:
    fake_store = FakeStore()
    monkeypatch.setattr(cli, "PgVectorStore", lambda **_kwargs: fake_store)
    return fake_store


def test_profiles_list_shows_default_profile(env):
    result = runner.invoke(cli.app, ["profiles", "list"])
    assert result.exit_code == 0
    assert "default:" in result.output
    assert "chunker=html_section" in result.output
    assert "table=chunks" in result.output


def test_ingest_without_confluence_warns_and_succeeds(store):
    result = runner.invoke(cli.app, ["ingest"])
    assert result.exit_code == 0
    assert store.schema_initialized
    assert not store.truncated


def test_ingest_full_truncates_table(store):
    result = runner.invoke(cli.app, ["ingest", "--full"])
    assert result.exit_code == 0
    assert store.truncated


def test_ingest_runs_confluence_pipeline(env, store, monkeypatch):
    for key, value in CONFLUENCE_ENV.items():
        env.setenv(key, value)

    calls: list[dict] = []

    def fake_ingest(confluence, embedding, fake_store, profile, **kwargs):
        calls.append({"profile": profile, **kwargs})
        return IngestResult(pages_processed=2, chunks_created=5)

    monkeypatch.setattr(cli, "ingest_confluence", fake_ingest)

    result = runner.invoke(cli.app, ["ingest"])
    assert result.exit_code == 0
    assert calls[0]["spaces"] == ["IT"]
    assert calls[0]["profile"].name == "default"


def test_ingest_unknown_profile_fails(store):
    result = runner.invoke(cli.app, ["ingest", "--profile", "nope"])
    assert result.exit_code != 0


def test_sync_without_confluence_exits_with_error(store):
    result = runner.invoke(cli.app, ["sync"])
    assert result.exit_code == 1


def test_sync_runs_confluence_sync(env, store, monkeypatch):
    for key, value in CONFLUENCE_ENV.items():
        env.setenv(key, value)

    calls: list[dict] = []

    def fake_sync(confluence, embedding, fake_store, profile, **kwargs):
        calls.append({"profile": profile, **kwargs})
        return SyncResult(pages_updated=1)

    monkeypatch.setattr(cli, "sync_confluence", fake_sync)

    result = runner.invoke(cli.app, ["sync"])
    assert result.exit_code == 0
    assert calls[0]["spaces"] == ["IT"]


def test_run_schedules_sync(env, store, monkeypatch):
    for key, value in CONFLUENCE_ENV.items():
        env.setenv(key, value)
    env.setenv("SYNC_FULL_ON_START", "true")

    ingest_calls: list[str] = []
    sync_calls: list[str] = []
    scheduled: list[str] = []

    monkeypatch.setattr(
        cli,
        "ingest_confluence",
        lambda *args, **kwargs: ingest_calls.append("ingest") or IngestResult(),
    )
    monkeypatch.setattr(
        cli,
        "sync_confluence",
        lambda *args, **kwargs: sync_calls.append("sync") or SyncResult(),
    )

    def fake_scheduler(cron_expression, job):
        scheduled.append(cron_expression)
        job()

    monkeypatch.setattr(cli, "run_scheduler", fake_scheduler)

    result = runner.invoke(cli.app, ["run"])
    assert result.exit_code == 0
    assert ingest_calls == ["ingest"]  # SYNC_FULL_ON_START
    assert sync_calls == ["sync"]  # one scheduled run
    assert scheduled == ["0 */6 * * *"]


def test_media_enabled_builds_attachment_ingestor(env, store, monkeypatch):
    for key, value in CONFLUENCE_ENV.items():
        env.setenv(key, value)
    env.setenv("MEDIA_ENABLED", "true")
    env.setenv("MEDIA_CAPTION_ENABLED", "true")
    env.setenv("ANTHROPIC_API_KEY", "sk-ant-test")

    captured: list = []

    def fake_ingest(confluence, embedding, fake_store, profile, **kwargs):
        captured.append(kwargs["attachment_ingestor"])
        return IngestResult()

    monkeypatch.setattr(cli, "ingest_confluence", fake_ingest)

    result = runner.invoke(cli.app, ["ingest"])
    assert result.exit_code == 0
    assert captured[0] is not None
