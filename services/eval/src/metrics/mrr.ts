/**
 * Reciprocal Rank for a single query.
 * The aggregator computes the mean across queries (MRR).
 */
export function meanReciprocalRank(retrievedIds: string[], relevantIds: string[]): number {
  if (relevantIds.length === 0) return 0;
  const relevantSet = new Set(relevantIds);

  for (let i = 0; i < retrievedIds.length; i++) {
    if (relevantSet.has(retrievedIds[i])) {
      return 1 / (i + 1);
    }
  }
  return 0;
}
