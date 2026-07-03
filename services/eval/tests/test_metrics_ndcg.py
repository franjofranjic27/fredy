import math

import pytest

from rag_eval.metrics import ndcg_at_k


def test_returns_1_for_a_perfect_ranking() -> None:
    assert ndcg_at_k(["a", "b", "c"], ["a", "b", "c"], 3) == pytest.approx(1, abs=1e-10)


def test_returns_1_when_only_relevant_items_appear_at_top_even_with_k_gt_relevant() -> None:
    assert ndcg_at_k(["a", "b"], ["a", "b"], 5) == pytest.approx(1, abs=1e-10)


def test_returns_0_when_no_relevant_items_are_retrieved() -> None:
    assert ndcg_at_k(["x", "y"], ["a", "b"], 2) == 0


def test_returns_0_when_relevant_list_is_empty() -> None:
    assert ndcg_at_k(["a"], [], 3) == 0


def test_penalises_later_positions_correctly() -> None:
    perfect = ndcg_at_k(["a", "x"], ["a"], 2)
    swapped = ndcg_at_k(["x", "a"], ["a"], 2)
    assert perfect > swapped
    assert perfect == pytest.approx(1, abs=1e-10)
    assert swapped == pytest.approx(1 / math.log2(3), abs=1e-10)


def test_respects_k_cutoff() -> None:
    assert ndcg_at_k(["x", "a"], ["a"], 1) == 0


def test_throws_on_non_positive_k() -> None:
    with pytest.raises(ValueError):
        ndcg_at_k(["a"], ["a"], 0)
