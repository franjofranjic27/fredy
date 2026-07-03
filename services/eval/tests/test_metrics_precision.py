import pytest

from rag_eval.metrics import precision_at_k


def test_returns_1_when_all_top_k_results_are_relevant() -> None:
    assert precision_at_k(["a", "b"], ["a", "b", "c"], 2) == 1


def test_returns_05_when_half_of_top_k_are_relevant() -> None:
    assert precision_at_k(["a", "x"], ["a", "b"], 2) == 0.5


def test_returns_0_when_none_of_top_k_are_relevant() -> None:
    assert precision_at_k(["x", "y"], ["a", "b"], 2) == 0


def test_returns_0_for_empty_retrieved_list() -> None:
    assert precision_at_k([], ["a"], 5) == 0


def test_uses_the_actual_retrieved_size_when_retrieved_lt_k() -> None:
    assert precision_at_k(["a"], ["a", "b"], 5) == 1


def test_ignores_items_beyond_k() -> None:
    assert precision_at_k(["x", "a", "b"], ["a", "b"], 1) == 0


def test_treats_relevant_ids_as_a_set() -> None:
    assert precision_at_k(["a"], ["a", "a"], 1) == 1


def test_throws_on_non_positive_k() -> None:
    with pytest.raises(ValueError):
        precision_at_k(["a"], ["a"], 0)
