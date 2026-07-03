from rag_eval.generator.rng import SeededRng


def test_produces_the_same_sequence_for_the_same_seed() -> None:
    a = SeededRng(42)
    b = SeededRng(42)
    assert [a.next() for _ in range(10)] == [b.next() for _ in range(10)]


def test_produces_a_different_sequence_for_different_seeds() -> None:
    assert SeededRng(1).next() != SeededRng(2).next()


def test_returns_values_in_unit_interval() -> None:
    rng = SeededRng(7)
    for _ in range(100):
        value = rng.next()
        assert 0 <= value < 1


def test_shuffles_deterministically_given_the_same_seed() -> None:
    items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    a = SeededRng(123).shuffle(list(items))
    b = SeededRng(123).shuffle(list(items))
    assert a == b


def test_shuffle_preserves_the_multiset_of_items() -> None:
    items = [1, 2, 3, 4, 5]
    shuffled = SeededRng(99).shuffle(list(items))
    assert sorted(shuffled) == sorted(items)


def test_matches_the_typescript_mulberry32_sequence() -> None:
    """Regression anchor: bit-exact port of the TS implementation.

    Reference values computed with the original TypeScript SeededRng
    (mulberry32) in Node. A seed used before the migration must keep
    producing the same sample.
    """
    rng = SeededRng(42)
    assert [rng.next() for _ in range(5)] == [
        0.6011037519201636,
        0.44829055899754167,
        0.8524657934904099,
        0.6697340414393693,
        0.17481389874592423,
    ]

    rng_123 = SeededRng(123)
    assert [rng_123.next() for _ in range(3)] == [
        0.7872516233474016,
        0.1785435655619949,
        0.49531551403924823,
    ]
