from pathlib import Path

import pytest

from confluence_importer.config import load_config
from confluence_importer.profiles import RagProfile, get_profile, load_profiles

BASE_ENV = {
    "EMBEDDING_PROVIDER": "openai",
    "EMBEDDING_API_KEY": "env-key",
    "EMBEDDING_MODEL": "text-embedding-3-small",
}


@pytest.fixture
def env(clean_env):
    for key, value in BASE_ENV.items():
        clean_env.setenv(key, value)
    return clean_env


def test_default_profile_from_env(env):
    profiles = load_profiles(load_config())
    assert set(profiles) == {"default"}
    default = profiles["default"]
    assert default.chunker == "html_section"
    assert default.embedding_provider == "openai"
    assert default.embedding_dimensions == 1536
    assert default.table_name == "chunks"
    assert default.chunker_params["max_tokens"] == 800


def test_default_profile_uses_chunks_table_env(env):
    env.setenv("CHUNKS_TABLE", "my_chunks")
    assert load_profiles(load_config())["default"].table_name == "my_chunks"


def test_loads_additional_profiles_from_yaml(env, tmp_path: Path):
    profiles_file = tmp_path / "profiles.yaml"
    profiles_file.write_text(
        """
profiles:
  - name: exp1
    chunker: recursive
    chunker_params:
      chunk_size: 1500
    embedding_provider: voyage
    embedding_model: voyage-3
    embedding_dimensions: 1024
  - name: exp2
    chunker: fixed_size
"""
    )
    env.setenv("PROFILES_FILE", str(profiles_file))

    profiles = load_profiles(load_config())
    assert set(profiles) == {"default", "exp1", "exp2"}

    exp1 = profiles["exp1"]
    assert exp1.chunker == "recursive"
    assert exp1.chunker_params == {"chunk_size": 1500}
    assert exp1.embedding_provider == "voyage"
    assert exp1.table_name == "chunks_exp1"

    # Unset fields fall back to the env-based embedding settings.
    exp2 = profiles["exp2"]
    assert exp2.embedding_provider == "openai"
    assert exp2.embedding_model == "text-embedding-3-small"
    assert exp2.table_name == "chunks_exp2"


def test_rejects_missing_profiles_file(env):
    env.setenv("PROFILES_FILE", "/nonexistent/profiles.yaml")
    with pytest.raises(FileNotFoundError):
        load_profiles(load_config())


def test_rejects_invalid_profile_name(env, tmp_path: Path):
    profiles_file = tmp_path / "profiles.yaml"
    profiles_file.write_text("profiles:\n  - name: 'bad name'\n")
    env.setenv("PROFILES_FILE", str(profiles_file))
    with pytest.raises(ValueError, match="Invalid identifier"):
        load_profiles(load_config())


def test_rejects_reserved_default_name(env, tmp_path: Path):
    profiles_file = tmp_path / "profiles.yaml"
    profiles_file.write_text("profiles:\n  - name: default\n")
    env.setenv("PROFILES_FILE", str(profiles_file))
    with pytest.raises(ValueError, match="reserved"):
        load_profiles(load_config())


def test_rejects_duplicate_profile_names(env, tmp_path: Path):
    profiles_file = tmp_path / "profiles.yaml"
    profiles_file.write_text("profiles:\n  - name: exp1\n  - name: exp1\n")
    env.setenv("PROFILES_FILE", str(profiles_file))
    with pytest.raises(ValueError, match="Duplicate"):
        load_profiles(load_config())


def test_get_profile_unknown_name(env):
    with pytest.raises(ValueError, match="Unknown profile"):
        get_profile(load_config(), "nope")


class TestResolveApiKey:
    def test_falls_back_to_default_key(self):
        profile = RagProfile(
            name="p",
            embedding_provider="openai",
            embedding_model="m",
            embedding_dimensions=8,
            table_name="chunks_p",
        )
        assert profile.resolve_api_key("default-key") == "default-key"

    def test_reads_profile_specific_env(self, monkeypatch):
        monkeypatch.setenv("VOYAGE_API_KEY", "voyage-key")
        profile = RagProfile(
            name="p",
            embedding_provider="voyage",
            embedding_model="m",
            embedding_dimensions=8,
            table_name="chunks_p",
            embedding_api_key_env="VOYAGE_API_KEY",
        )
        assert profile.resolve_api_key("default-key") == "voyage-key"

    def test_missing_profile_env_raises(self, monkeypatch):
        monkeypatch.delenv("MISSING_KEY", raising=False)
        profile = RagProfile(
            name="p",
            embedding_provider="voyage",
            embedding_model="m",
            embedding_dimensions=8,
            table_name="chunks_p",
            embedding_api_key_env="MISSING_KEY",
        )
        with pytest.raises(ValueError, match="MISSING_KEY"):
            profile.resolve_api_key("default-key")
