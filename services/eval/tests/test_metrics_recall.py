import pytest

from rag_eval.metrics import recall_at_k


def test_returns_1_when_all_relevant_items_are_in_top_k() -> None:
    assert recall_at_k(["a", "b", "c"], ["a", "b"], 3) == 1


def test_returns_the_fraction_of_relevant_items_found_in_top_k() -> None:
    assert recall_at_k(["a", "x", "y"], ["a", "b"], 3) == 0.5


def test_returns_0_when_no_retrieved_ids_match_relevant_ids() -> None:
    assert recall_at_k(["x", "y", "z"], ["a", "b"], 3) == 0


def test_returns_0_for_empty_retrieved_list() -> None:
    assert recall_at_k([], ["a", "b"], 5) == 0


def test_returns_0_when_relevant_list_is_empty() -> None:
    assert recall_at_k(["a", "b"], [], 3) == 0


def test_only_considers_the_first_k_retrieved_ids() -> None:
    assert recall_at_k(["x", "y", "a", "b"], ["a", "b"], 2) == 0
    assert recall_at_k(["x", "y", "a", "b"], ["a", "b"], 4) == 1


def test_handles_k_larger_than_retrieved_list() -> None:
    assert recall_at_k(["a"], ["a", "b"], 10) == 0.5


def test_deduplicates_relevant_ids_by_treating_them_as_a_set() -> None:
    assert recall_at_k(["a"], ["a", "a"], 1) == 1


def test_throws_on_non_positive_k() -> None:
    with pytest.raises(ValueError):
        recall_at_k(["a"], ["a"], 0)
    with pytest.raises(ValueError):
        recall_at_k(["a"], ["a"], -1)
