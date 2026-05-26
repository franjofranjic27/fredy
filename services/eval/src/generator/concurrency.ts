/**
 * Run an async mapper over items with at most `limit` concurrent in-flight
 * calls. Preserves input order in the result, regardless of completion order.
 * Failures are surfaced as `null` so the caller can skip individual items
 * without aborting the whole run.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<Array<R | null>> {
  const results: Array<R | null> = new Array(items.length).fill(null);
  let cursor = 0;

  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      try {
        results[index] = await mapper(items[index], index);
      } catch {
        results[index] = null;
      }
    }
  });

  await Promise.all(workers);
  return results;
}
