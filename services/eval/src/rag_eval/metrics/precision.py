from collections.abc import Sequence


def precision_at_k(retrieved_ids: Sequence[str], relevant_ids: Sequence[str], k: int) -> float:
    """Fraction of the top-k retrieved ids that are relevant.

    Uses the actual retrieved size when fewer than k results were returned,
    so a single correct hit at k=5 still scores 1.0.
    """
    if k <= 0:
        raise ValueError(f"k must be positive, got {k}")

    top_k = retrieved_ids[:k]
    if len(top_k) == 0:
        return 0.0

    relevant_set = set(relevant_ids)
    hits = sum(1 for chunk_id in top_k if chunk_id in relevant_set)
    return hits / len(top_k)
