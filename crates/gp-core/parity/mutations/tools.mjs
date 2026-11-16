// What a generator draws from, and the seeded random numbers it draws with: shared by the checks of the mutators and of sync.

export function rng(seed) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** What a generator draws from: a random number, a pick, a maybe, and the TS database's ids of a table. */
export function tools(random, db) {
  const pick = (xs) => xs[Math.floor(random() * xs.length)];
  const maybe = (p, f) => (random() < p ? f() : undefined);
  const idsOf = (sql) => db.prepare(sql).all().map((r) => Object.values(r)[0]);
  const opt = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
  let n = 0;
  const fresh = (p) => `${p}${++n}`;
  /** One of `good` mostly, one of `bad` now and then (an invalid argument, a limit). */
  const mostly = (good, bad, p = 0.9) => (random() < p ? pick(good) : pick(bad));
  return { random, pick, maybe, mostly, idsOf, opt, fresh };
}
