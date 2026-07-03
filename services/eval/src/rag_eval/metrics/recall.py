from collections.abc import Sequence


def recall_at_k(retrieved_ids: Sequence[str], relevant_ids: Sequence[str], k: int) -> float:
    """Fraction of all (deduplicated) relevant ids recovered within the top-k."""
    if k <= 0:
        raise ValueError(f"k must be positive, got {k}")
    if len(relevant_ids) == 0:
        return 0.0

    relevant_set = set(relevant_ids)
    top_k = retrieved_ids[:k]
    hits = sum(1 for chunk_id in top_k if chunk_id in relevant_set)
    return hits / len(relevant_set)
