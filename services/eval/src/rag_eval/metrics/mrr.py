from collections.abc import Sequence


def reciprocal_rank(retrieved_ids: Sequence[str], relevant_ids: Sequence[str]) -> float:
    """Reciprocal rank of the first relevant hit for a single query.

    The aggregator computes the mean across queries (MRR).
    """
    if len(relevant_ids) == 0:
        return 0.0
    relevant_set = set(relevant_ids)

    for position, chunk_id in enumerate(retrieved_ids):
        if chunk_id in relevant_set:
            return 1 / (position + 1)
    return 0.0
