// Scenarios against the core (docs/view-models.md): a small organisation made by the mutators, presenting moved by its
// keys, and what each page offers asked in each state as the shells ask it. The answers are kept in
// scenarios/<name>.expected.json: a change to a rule changes that file (`vitest -u`), to be read in the diff, and the
// shells' own tests check what they draw against the same file.
import { describe, expect, it } from 'vitest';
import { Core } from '../../src/core.ts';
import { madeScenario as made, readScenario as scenario, type ScenarioItem as Item, type ScenarioPage as Page } from '../../src/node/scenarios.ts';

interface Shown { itemId: string | null; partIndex: number; black: boolean }

/** A value with every object's keys in order, as the Rust core wrote them when the file was made: the file is the same whichever core answers. */
const sorted = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(sorted) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, x]) => [k, sorted(x)])) : v;

/** The running order's slides as presenting's views take them: [itemId, its number of slides]. */
const slideOrder = (p: Page) => p.items.map((i) => [i.id, p.slides[i.id]?.slides.length ?? 0]);

/** Presenting after `keys`, from its start (nothing shown yet), or before it. */
function presentingAfter(core: Core, p: Page, presenting: boolean, keys: object[]) {
  let state = { presenting, shown: { itemId: null, partIndex: 0, black: false } as Shown, picked: null as unknown };
  for (const key of keys) state = core.pure('presentingKeyView', { order: slideOrder(p), state, key });
  return state;
}

/** An item's menu asked as the shells ask it: the item, its song and the song's arrangements, the overlays, the item on the outputs. */
function menuOf(core: Core, p: Page, item: Item, shownId: string | null) {
  const song = item.type === 'song' ? (p.songs.find((x) => x.id === item.sourceId) ?? null) : null;
  const arrangements = item.type === 'song' ? p.arrangements.filter((a) => a.songId === item.sourceId) : [];
  return core.pure<{ groups: unknown[] }>('itemActionsView', { item, song, arrangements, overlays: p.overlays, shownId }).groups;
}

/**
 * What the scenario's presentation offers in each state: the slide shown and marked, each item's menu, where + adds,
 * whether ▶ may start here and in the other presentation, and the page's state after each of `keys`, played from the
 * page as it stands (the item shown selected).
 */
async function played(name: string) {
  const s = scenario(name);
  const { core: madeCore, page } = await made(s);
  const core = { pure: <T>(view: string, args: unknown) => sorted(madeCore.pure<T>(view, args)) as T } as Core;
  const p = await page();
  const other = await page(s.other);
  const order = p.items.map((i) => i.id);
  const states = s.states.map(({ name: state, presenting, keys }) => {
    const now = presentingAfter(core, p, presenting, keys);
    const shownId = presenting ? now.shown.itemId : null;
    const live = { presentationId: presenting ? s.presentation : null, ...now.shown };
    const context = (presentationId: string) => ({ presentationId, isTemplate: false, presenting: live.presentationId === presentationId, live });
    const canStart = (id: string, pg: Page) => core.pure<{ canStart: boolean }>('pageModelView', { state: {}, context: context(id), order: slideOrder(pg) }).canStart;
    let pageState: object = { presenting, selectedId: shownId, followed: shownId };
    const pressed = s.keys.map((event) => {
      const answer = core.pure<{ state: object; live: unknown; command: unknown; handled: boolean }>('pageEventView', { state: pageState, context: context(s.presentation), order: slideOrder(p), event });
      pageState = answer.state;
      return { event, ...answer };
    });
    return {
      state,
      shown: presenting ? now.shown : null,
      marks: presenting ? core.pure('slideMarksView', { order: slideOrder(p), shown: now.shown }) : null,
      menus: Object.fromEntries(p.items.map((i) => [i.id, menuOf(core, p, i, shownId)])),
      adds: s.adds.map((add) => ({ ...add, after: core.pure('addPositionView', { order, shownId, ...add }) })),
      canStart: { [s.presentation]: canStart(s.presentation, p), [s.other]: canStart(s.other, other) },
      keys: pressed,
    };
  });
  // The items' titles too, by which a shell's test finds an item's … (its accessibility label names it).
  return { items: p.items.map((i) => ({ id: i.id, title: i.title })), states };
}

describe('scenarios', () => {
  it('sunday: the core offers what sunday.expected.json says, in every state', async () => {
    const got = await played('sunday');

    await expect(`${JSON.stringify(got, null, 2)}\n`).toMatchFileSnapshot('../../scenarios/sunday.expected.json');
  });

  it('sunday: removing the item left black would send → back to the first slide, which is why it may not be removed', async () => {
    const s = scenario('sunday');
    const { core, mutate, page } = await made(s);
    const black = s.states.find((x) => x.name === 'black')!;
    const before = presentingAfter(core, await page(), true, black.keys);
    await mutate('removeItem', { itemId: before.shown.itemId! });

    const after = core.pure<{ shown: Shown }>('presentingKeyView', { order: slideOrder(await page()), state: before, key: { type: 'step', delta: 1 } });

    expect(after.shown).toEqual({ itemId: 'i0', partIndex: 0, black: false });
  });
});
