// The core's Slå på utgångar automatiskt (`autoOutputsView`, crates/gp-core/src/settings_models.rs), which the Mac app
// uses, against the web's own (live/autoOutputs.ts, and the step of pages/live/useAutoOutputs.ts), on random displays.
import { describe, expect, it } from 'vitest';
import { pageCore } from '../src/db/pageCore.ts';
import { displaysToTurnOn } from '../src/live/autoOutputs.ts';
import type { OutputDisplay } from '../src/live/outputWindow.ts';

/** A small deterministic random source, so a failure repeats. */
function random(seed: number) {
  let s = seed;
  return () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
}

/** useAutoOutputs's step: what a change of the displays from `before` to `now` switches on and off. */
function webStep(before: OutputDisplay[] | null, now: OutputDisplay[], last: Record<string, boolean>, open: string[]) {
  const added = before ? now.filter((d) => !before.some((k) => k.id === d.id)) : now;
  return { on: displaysToTurnOn(added, last), off: (before ?? []).filter((d) => !now.some((n) => n.id === d.id) && open.includes(d.id)).map((d) => d.id) };
}

describe('autoOutputsView', () => {
  it('switches on and off what the web switches, over 500 random changes', () => {
    const core = pageCore();
    const r = random(7);
    const pool: OutputDisplay[] = Array.from({ length: 6 }, (_, i) => ({ id: `d${i}`, name: `Skärm ${i % 4}` }));
    const some = () => pool.filter(() => r() < 0.5);
    const cases = Array.from({ length: 500 }, () => {
      const before = r() < 0.2 ? null : some();
      const last = Object.fromEntries(pool.filter(() => r() < 0.4).map((d) => [d.name, r() < 0.5]));
      return { before, now: some(), last, open: some().map((d) => d.id) };
    });

    const answers = cases.map((c) => core.pure<{ on: string[]; off: string[] }>('autoOutputsView', c));

    expect(answers).toEqual(cases.map((c) => webStep(c.before, c.now, c.last, c.open)));
  });
});
