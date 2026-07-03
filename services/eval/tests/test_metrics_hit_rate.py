from rag_eval.metrics import hit_rate


def test_returns_1_when_at_least_one_relevant_id_is_retrieved() -> None:
    assert hit_rate(["x", "a"], ["a", "b"]) == 1


def test_returns_0_when_no_relevant_id_is_retrieved() -> None:
    assert hit_rate(["x", "y"], ["a", "b"]) == 0


def test_returns_0_for_empty_retrieved_list() -> None:
    assert hit_rate([], ["a"]) == 0


def test_returns_0_when_relevant_list_is_empty() -> None:
    assert hit_rate(["a", "b"], []) == 0
