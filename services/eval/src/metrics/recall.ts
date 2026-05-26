export function recallAtK(retrievedIds: string[], relevantIds: string[], k: number): number {
  if (k <= 0) throw new Error(`k must be positive, got ${k}`);
  if (relevantIds.length === 0) return 0;

  const relevantSet = new Set(relevantIds);
  const topK = retrievedIds.slice(0, k);
  const hits = topK.reduce((acc, id) => acc + (relevantSet.has(id) ? 1 : 0), 0);
  return hits / relevantSet.size;
}
