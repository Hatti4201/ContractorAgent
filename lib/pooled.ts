/** Runs `work` over `items`, at most `limit` at a time, in order of start. */
export async function pooled<T>(items: T[], limit: number, work: (item: T, index: number) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      await work(items[index]!, index);
    }
  }));
}
