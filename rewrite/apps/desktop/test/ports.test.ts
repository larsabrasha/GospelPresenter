import { describe, expect, it } from 'vitest';
import { PORT_RANGES, workerPort } from '../e2e/ports.ts';

describe('the ports e2e workers take', () => {
  it('never gives two workers the same port', () => {
    const taken = new Map<number, number>();
    for (let worker = 0; worker < PORT_RANGES; worker++) {
      for (const n of [0, 1, 999, 1_000, 123_456]) {
        const port = workerPort(worker, n);
        expect(taken.get(port) ?? worker).toBe(worker);
        taken.set(port, worker);
      }
    }
  });

  it('stays below the ports the system hands out itself', () => {
    const ports = [workerPort(0, 0), workerPort(PORT_RANGES - 1, 999_999)];

    expect(Math.min(...ports)).toBeGreaterThanOrEqual(20_000);
    expect(Math.max(...ports)).toBeLessThan(49_152);
  });

  it('refuses a worker beyond the ranges rather than share one', () => {
    expect(() => workerPort(PORT_RANGES, 0)).toThrow();
  });
});
