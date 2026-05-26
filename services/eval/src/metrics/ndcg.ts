export function ndcgAtK(retrievedIds: string[], relevantIds: string[], k: number): number {
  if (k <= 0) throw new Error(`k must be positive, got ${k}`);
  if (relevantIds.length === 0) return 0;

  const relevantSet = new Set(relevantIds);
  const topK = retrievedIds.slice(0, k);

  const dcg = topK.reduce((acc, id, i) => {
    const gain = relevantSet.has(id) ? 1 : 0;
    return acc + gain / Math.log2(i + 2);
  }, 0);

  const idealHits = Math.min(relevantSet.size, k);
  let idcg = 0;
  for (let i = 0; i < idealHits; i++) {
    idcg += 1 / Math.log2(i + 2);
  }

  if (idcg === 0) return 0;
  return dcg / idcg;
}
