const FIRST_PORT = 20_000;
/** Below macOS's ephemeral ports (49 152 on), which the system hands out to port 0 and outgoing connections. */
const END_PORT = 49_000;
const RANGE = 1_000;

/** Ranges of ports, one per worker; playwright.config.ts runs no more workers. */
export const PORT_RANGES = Math.floor((END_PORT - FIRST_PORT) / RANGE);

/** The `n`th port of a worker (its TEST_PARALLEL_INDEX): its own range, so two workers never share one. */
export function workerPort(worker: number, n: number): number {
  if (worker >= PORT_RANGES) throw new Error(`e2e worker ${worker} has no port range; at most ${PORT_RANGES} workers`);
  return FIRST_PORT + worker * RANGE + (n % RANGE);
}
