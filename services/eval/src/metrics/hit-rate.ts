export function hitRate(retrievedIds: string[], relevantIds: string[]): 0 | 1 {
  if (relevantIds.length === 0) return 0;
  const relevantSet = new Set(relevantIds);
  return retrievedIds.some((id) => relevantSet.has(id)) ? 1 : 0;
}
