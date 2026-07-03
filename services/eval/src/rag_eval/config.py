from typing import Literal

from pydantic import AliasChoices, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

EmbeddingProvider = Literal["openai", "voyage", "cohere"]
RerankerName = Literal["none", "cohere", "voyage"]

DEFAULT_RERANK_MODELS: dict[str, str] = {
    "cohere": "rerank-v3.5",
    "voyage": "rerank-2.5",
}


class Settings(BaseSettings):
    """Environment configuration for the eval harness.

    Embedding provider/model/dimensions act as fallbacks: when a profile row
    exists in ``rag_profiles`` its values win, otherwise these are used.
    """

    model_config = SettingsConfigDict(extra="ignore", populate_by_name=True)

    database_url: str = Field(
        default="postgresql://fredy:fredy@localhost:5432/fredy",
        validation_alias=AliasChoices("DATABASE_URL"),
    )
    anthropic_api_key: str | None = Field(
        default=None, validation_alias=AliasChoices("ANTHROPIC_API_KEY")
    )
    embedding_api_key: str | None = Field(
        default=None, validation_alias=AliasChoices("EMBEDDING_API_KEY")
    )
    embedding_provider: EmbeddingProvider | None = Field(
        default=None, validation_alias=AliasChoices("EMBEDDING_PROVIDER")
    )
    embedding_model: str | None = Field(
        default=None, validation_alias=AliasChoices("EMBEDDING_MODEL")
    )
    embedding_dimensions: int | None = Field(
        default=None, gt=0, validation_alias=AliasChoices("EMBEDDING_DIMENSIONS")
    )
    # CHUNKS_TABLE is the legacy name used by the former TypeScript service.
    vector_table: str = Field(
        default="chunks", validation_alias=AliasChoices("VECTOR_TABLE", "CHUNKS_TABLE")
    )
    eval_dataset_path: str = Field(
        default="data/golden.jsonl", validation_alias=AliasChoices("EVAL_DATASET_PATH")
    )
    eval_k_values: str = Field(default="1,3,5,10", validation_alias=AliasChoices("EVAL_K_VALUES"))
    eval_search_limit: int = Field(
        default=20, gt=0, validation_alias=AliasChoices("EVAL_SEARCH_LIMIT")
    )
    eval_score_threshold: float = Field(
        default=0.0, ge=0.0, le=1.0, validation_alias=AliasChoices("EVAL_SCORE_THRESHOLD")
    )
    eval_reports_dir: str = Field(
        default="reports", validation_alias=AliasChoices("EVAL_REPORTS_DIR")
    )
    reranker: RerankerName = Field(default="none", validation_alias=AliasChoices("RERANKER"))
    rerank_api_key: str | None = Field(
        default=None, validation_alias=AliasChoices("RERANK_API_KEY")
    )
    rerank_model: str | None = Field(default=None, validation_alias=AliasChoices("RERANK_MODEL"))
    rerank_top_n: int = Field(default=10, gt=0, validation_alias=AliasChoices("RERANK_TOP_N"))
    rerank_threshold: float = Field(default=0.0, validation_alias=AliasChoices("RERANK_THRESHOLD"))

    @field_validator("eval_k_values")
    @classmethod
    def _validate_k_values(cls, raw: str) -> str:
        parse_k_values(raw)
        return raw

    @property
    def k_values(self) -> list[int]:
        return parse_k_values(self.eval_k_values)

    def resolved_rerank_model(self, provider: str) -> str:
        if self.rerank_model:
            return self.rerank_model
        default = DEFAULT_RERANK_MODELS.get(provider)
        if default is None:
            raise ValueError(f"Unsupported reranker provider: {provider}")
        return default


def parse_k_values(raw: str) -> list[int]:
    """Parse a comma-separated list of k values into sorted unique positive ints."""
    values: list[int] = []
    for part in (p.strip() for p in raw.split(",")):
        if not part:
            continue
        try:
            n = int(part)
        except ValueError as error:
            raise ValueError(
                f'EVAL_K_VALUES contains invalid value: "{part}" (expected positive integers)'
            ) from error
        if n <= 0:
            raise ValueError(
                f'EVAL_K_VALUES contains invalid value: "{part}" (expected positive integers)'
            )
        values.append(n)
    if not values:
        raise ValueError("EVAL_K_VALUES must contain at least one positive integer")
    return sorted(set(values))
