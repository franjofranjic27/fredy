export function precisionAtK(retrievedIds: string[], relevantIds: string[], k: number): number {
  if (k <= 0) throw new Error(`k must be positive, got ${k}`);

  const topK = retrievedIds.slice(0, k);
  if (topK.length === 0) return 0;

  const relevantSet = new Set(relevantIds);
  const hits = topK.reduce((acc, id) => acc + (relevantSet.has(id) ? 1 : 0), 0);
  return hits / topK.length;
}
