import math
from collections.abc import Sequence


def ndcg_at_k(retrieved_ids: Sequence[str], relevant_ids: Sequence[str], k: int) -> float:
    """Normalized discounted cumulative gain at k with binary relevance."""
    if k <= 0:
        raise ValueError(f"k must be positive, got {k}")
    if len(relevant_ids) == 0:
        return 0.0

    relevant_set = set(relevant_ids)
    top_k = retrieved_ids[:k]

    dcg = sum(
        (1 if chunk_id in relevant_set else 0) / math.log2(position + 2)
        for position, chunk_id in enumerate(top_k)
    )

    ideal_hits = min(len(relevant_set), k)
    idcg = sum(1 / math.log2(position + 2) for position in range(ideal_hits))

    if idcg == 0:
        return 0.0
    return dcg / idcg
