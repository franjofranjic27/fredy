"""RAG profiles — the unit of A/B experimentation.

A profile bundles a chunking strategy (with parameters), an embedding model and
a dedicated chunks table. The ``default`` profile is derived from the flat env
vars; additional profiles are loaded from an optional YAML file (PROFILES_FILE).
"""

import os
import re
from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, Field, field_validator

from confluence_importer.config import Config

DEFAULT_PROFILE_NAME = "default"

_IDENTIFIER_PATTERN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


class RagProfile(BaseModel):
    name: str
    chunker: str = "html_section"
    chunker_params: dict[str, Any] = Field(default_factory=dict)
    embedding_provider: str
    embedding_model: str
    embedding_dimensions: int
    table_name: str
    embedding_api_key_env: str | None = None

    @field_validator("name", "table_name")
    @classmethod
    def _validate_identifier(cls, value: str) -> str:
        if not _IDENTIFIER_PATTERN.match(value):
            raise ValueError(
                f"Invalid identifier: {value!r} (must match {_IDENTIFIER_PATTERN.pattern})"
            )
        return value

    def resolve_api_key(self, default_api_key: str) -> str:
        """Profile-specific API key from ``embedding_api_key_env``, else EMBEDDING_API_KEY."""
        if self.embedding_api_key_env:
            key = os.environ.get(self.embedding_api_key_env, "")
            if not key:
                raise ValueError(
                    f"Profile {self.name!r} requires env var {self.embedding_api_key_env}"
                )
            return key
        return default_api_key


def default_profile(config: Config) -> RagProfile:
    return RagProfile(
        name=DEFAULT_PROFILE_NAME,
        chunker="html_section",
        chunker_params={
            "max_tokens": config.chunking.max_tokens,
            "overlap_tokens": config.chunking.overlap_tokens,
            "preserve_code_blocks": config.chunking.preserve_code_blocks,
            "preserve_tables": config.chunking.preserve_tables,
        },
        embedding_provider=config.embedding.provider,
        embedding_model=config.embedding.model,
        embedding_dimensions=config.embedding.dimensions,
        table_name=config.database.table,
    )


def _profile_from_yaml(entry: dict[str, Any], config: Config) -> RagProfile:
    name = str(entry.get("name", ""))
    return RagProfile(
        name=name,
        chunker=entry.get("chunker", "html_section"),
        chunker_params=entry.get("chunker_params") or {},
        embedding_provider=entry.get("embedding_provider", config.embedding.provider),
        embedding_model=entry.get("embedding_model", config.embedding.model),
        embedding_dimensions=int(entry.get("embedding_dimensions", config.embedding.dimensions)),
        table_name=f"chunks_{name}",
        embedding_api_key_env=entry.get("embedding_api_key_env"),
    )


def load_profiles(config: Config) -> dict[str, RagProfile]:
    """All configured profiles keyed by name. The default profile always exists."""
    profiles: dict[str, RagProfile] = {DEFAULT_PROFILE_NAME: default_profile(config)}

    if not config.profiles_file:
        return profiles

    path = Path(config.profiles_file)
    if not path.is_file():
        raise FileNotFoundError(f"PROFILES_FILE not found: {path}")

    document = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    entries = document.get("profiles") or []
    if not isinstance(entries, list):
        raise ValueError("PROFILES_FILE must contain a top-level 'profiles' list")

    for entry in entries:
        if not isinstance(entry, dict):
            raise ValueError(f"Invalid profile entry (expected mapping): {entry!r}")
        profile = _profile_from_yaml(entry, config)
        if profile.name == DEFAULT_PROFILE_NAME:
            raise ValueError("Profile name 'default' is reserved for the env-based profile")
        if profile.name in profiles:
            raise ValueError(f"Duplicate profile name: {profile.name!r}")
        profiles[profile.name] = profile

    return profiles


def get_profile(config: Config, name: str) -> RagProfile:
    profiles = load_profiles(config)
    if name not in profiles:
        available = ", ".join(sorted(profiles))
        raise ValueError(f"Unknown profile: {name!r}. Available: {available}")
    return profiles[name]
