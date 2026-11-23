// @vitest-environment happy-dom
// What the web's item menus draw, checked against the core's answers for the same scenario (docs/view-models.md):
// packages/rust-core/scenarios/sunday.json made in memory, and in each state of sunday.expected.json each item's menu,
// the computer's … (ItemContextMenu) and a phone's sheet (ItemSheet), holds the entries the core offers, enabled as it
// says, and none that it does not offer. iOS checks its own menus against the same file (apps/mac/ios/UITests).
import type { Overlay, PresentationItem, Song, SongArrangement } from '@gp/core';
import { madeScenario, readScenario, scenarioAnswers, type ScenarioAction, type ScenarioPage } from '@gp/core/scenarios';
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, describe, expect, it } from 'vitest';
import { DbProvider } from '../src/db/react.tsx';
import { t } from '../src/i18n.ts';
import { ItemContextMenu, type ItemMenuSource } from '../src/pages/live/ItemContextMenu.tsx';
import { ItemSheet } from '../src/pages/live/phone/ItemSheet.tsx';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** The texts each action may have: to find it drawn, and to find one drawn that the core did not offer. */
const TEXTS: Record<string, string[]> = {
  rename: [t('header.rename')],
  edit: [t('presentation.editSong')],
  editImages: [t('presentation.editImages')],
  note: [t('note.title')],
  arrangement: [t('song.arrangements')],
  overlay: [t('overlays.itemOverlay')],
  addAfter: [t('live.addAfter')],
  tick: [t('presentation.tick')],
  delete: [t('common.delete'), t('live.shownCannotRemove')],
};

/** Every control drawn in the page, by the texts it shows (each text of it, or its aria-label), and whether it is enabled. */
function controls(): { texts: Set<string>; enabled: boolean }[] {
  return [...document.body.querySelectorAll('button, a, select')].map((el) => {
    const texts = new Set<string>();
    const label = el.getAttribute('aria-label');
    if (label) texts.add(label);
    // The label of a row inside its <label> (a phone's settings) names its select.
    const row = el.closest('label') ?? el;
    const walk = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) if (n.textContent?.trim()) texts.add(n.textContent.trim());
    return { texts, enabled: !(el as HTMLButtonElement).disabled };
  });
}

/** `node` drawn in the page; what it drew, read; the page emptied again. */
async function drawn(node: ReactNode) {
  const root = createRoot(document.body.appendChild(document.createElement('div')));
  await act(async () => root.render(<DbProvider db={{} as never}>{node}</DbProvider>));
  const read = controls();
  await act(async () => root.unmount());
  document.body.replaceChildren();
  return read;
}

/** What is wrong with a drawn menu against the core's actions: one missing, enabled otherwise, or drawn but not offered. */
function differences(read: { texts: Set<string>; enabled: boolean }[], offered: ScenarioAction[]): string[] {
  const out: string[] = [];
  for (const a of offered) {
    const control = read.find((c) => c.texts.has(t(a.text as never)));
    if (!control) out.push(`${a.id} missing`);
    else if (control.enabled !== a.enabled) out.push(`${a.id} ${control.enabled ? 'enabled' : 'disabled'}`);
  }
  // A text an offered action has too says nothing ("Redigera" is a song's and a picture item's).
  const offeredTexts = new Set(offered.map((a) => t(a.text as never)));
  for (const [id, texts] of Object.entries(TEXTS)) {
    if (offered.some((a) => a.id === id)) continue;
    if (read.some((c) => texts.some((x) => !offeredTexts.has(x) && c.texts.has(x)))) out.push(`${id} drawn but not offered`);
  }
  return out;
}

const answers = scenarioAnswers('sunday');
let page: ScenarioPage;
beforeAll(async () => {
  page = await (await madeScenario(readScenario('sunday'))).page();
});

describe.each(answers.states)('the $state state of the sunday scenario', ({ state, shown, menus }) => {
  // The item on the outputs while presenting, black or not, as the pages pass it.
  const shownId = shown?.itemId ?? null;
  const items = () => page.items as unknown as PresentationItem[];
  const songs = () => new Map(page.songs.map((s) => [s.id, s as unknown as Song]));

  it("draws each item's menu on a computer as the core offers it", async () => {
    const source: ItemMenuSource = {
      songs: songs(),
      arrangements: page.arrangements as unknown as SongArrangement[],
      overlays: page.overlays as unknown as Overlay[],
      shownId,
      editHref: () => '#song',
      onEditImages: () => {},
      onAddAfter: () => {},
      onRename: () => {},
      onNote: () => {},
      onTick: () => {},
      onRemove: () => {},
    };
    const wrong: string[] = [];

    for (const item of items()) {
      const read = await drawn(<ItemContextMenu menu={{ item, at: { x: 0, y: 0 } }} source={source} onClose={() => {}} />);
      wrong.push(...differences(read, menus[item.id]!.flatMap((g) => g.actions)).map((d) => `${state}, ${item.title}: ${d}`));
    }

    expect(wrong).toEqual([]);
  });

  it("draws each item's sheet on a phone as the core offers it", async () => {
    const on = { onRename: () => {}, onNote: () => {}, onEditImages: () => {}, onAddAfter: () => {}, onTick: () => {}, onRemove: () => {} };
    const wrong: string[] = [];

    for (const item of items()) {
      const sheet = (
        <ItemSheet item={item} songs={songs()} arrangements={page.arrangements as unknown as SongArrangement[]} overlays={page.overlays as unknown as Overlay[]} shownId={shownId} on={on} onClose={() => {}} />
      );
      const read = await drawn(sheet);
      wrong.push(...differences(read, menus[item.id]!.flatMap((g) => g.actions)).map((d) => `${state}, ${item.title}: ${d}`));
    }

    expect(wrong).toEqual([]);
  });
});
