from collections.abc import Sequence


def hit_rate(retrieved_ids: Sequence[str], relevant_ids: Sequence[str]) -> int:
    """1 if at least one relevant id was retrieved anywhere, else 0."""
    if len(relevant_ids) == 0:
        return 0
    relevant_set = set(relevant_ids)
    return 1 if any(chunk_id in relevant_set for chunk_id in retrieved_ids) else 0
