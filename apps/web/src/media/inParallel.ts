/**
 * Runs `fn` on each of `items`, four at a time, as an import's uploads and an export's downloads go; `done` after each.
 * The first failure stops the rest from starting, and is thrown: the job is then run again from its start.
 */
export async function inParallel<T>(items: readonly T[], fn: (item: T) => Promise<void>, done: (n: number) => void = () => {}): Promise<void> {
  const queue = [...items];
  let finished = 0;
  let failed = false;
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      for (let item = queue.shift(); item !== undefined && !failed; item = queue.shift()) {
        try {
          await fn(item);
        } catch (e) {
          failed = true;
          throw e;
        }
        done(++finished);
      }
    }),
  );
}
