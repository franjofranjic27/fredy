from rag_eval.metrics import reciprocal_rank


def test_returns_1_when_first_retrieved_item_is_relevant() -> None:
    assert reciprocal_rank(["a", "x", "y"], ["a"]) == 1


def test_returns_half_when_second_retrieved_item_is_the_first_relevant_hit() -> None:
    assert reciprocal_rank(["x", "a"], ["a"]) == 1 / 2


def test_returns_third_when_third_retrieved_item_is_the_first_relevant_hit() -> None:
    assert reciprocal_rank(["x", "y", "a"], ["a", "b"]) == 1 / 3


def test_returns_0_when_no_retrieved_item_is_relevant() -> None:
    assert reciprocal_rank(["x", "y"], ["a", "b"]) == 0


def test_returns_0_for_empty_retrieved_list() -> None:
    assert reciprocal_rank([], ["a"]) == 0


def test_returns_0_when_relevant_list_is_empty() -> None:
    assert reciprocal_rank(["a", "b"], []) == 0


def test_only_counts_the_first_relevant_hit() -> None:
    assert reciprocal_rank(["x", "a", "b"], ["a", "b"]) == 1 / 2
