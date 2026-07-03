"""Token counting with the cl100k_base BPE tokenizer (used by text-embedding-3-*)."""

from functools import lru_cache

import tiktoken


@lru_cache(maxsize=1)
def get_encoding() -> tiktoken.Encoding:
    return tiktoken.get_encoding("cl100k_base")


def count_tokens(text: str) -> int:
    """More accurate than the 1-token-per-4-chars heuristic, especially for code and URLs."""
    return len(get_encoding().encode(text))
