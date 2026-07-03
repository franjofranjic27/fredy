UINT32_MASK = 0xFFFFFFFF


class SeededRng:
    """Deterministic pseudo-random number generator (mulberry32).

    Bit-exact port of the TypeScript implementation: same seed produces the
    same sequence, so golden dataset sampling stays reproducible across the
    language migration. Not cryptographically secure — not needed here.
    """

    def __init__(self, seed: int) -> None:
        self._state = seed & UINT32_MASK

    def next(self) -> float:
        """Return the next float in [0, 1)."""
        self._state = (self._state + 0x6D2B79F5) & UINT32_MASK
        t = self._state
        t = ((t ^ (t >> 15)) * (t | 1)) & UINT32_MASK
        t ^= (t + (((t ^ (t >> 7)) * (t | 61)) & UINT32_MASK)) & UINT32_MASK
        t &= UINT32_MASK
        return (t ^ (t >> 14)) / 4294967296

    def shuffle[T](self, items: list[T]) -> list[T]:
        """Fisher-Yates shuffle in place."""
        for i in range(len(items) - 1, 0, -1):
            j = int(self.next() * (i + 1))
            items[i], items[j] = items[j], items[i]
        return items
