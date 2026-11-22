// A presentation's details dialog (`detailsStepView`, crates/gp-core/src/details_form.rs): what it opens with, what
// Spara and Skapa run, when they may be pressed, what ↵, Avbryt and a refused change do, as the web's
// PresentationDetailsDialog, DetailsDialog and CreatePresentationDialog decided them.
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { MutatorCtx } from '@gp/core';
import type { DetailsEvent, DetailsStep, Rows } from '../src/index.ts';
import { nodeRustCore } from '../src/node.ts';

const admin: MutatorCtx = { userId: 'u', role: 'admin', now: 1000 };

/** A presentation there (P, in the light theme), and a template for Sundays at 11 with two items (T). */
async function dialog(init: object) {
  const db = new DatabaseSync(':memory:');
  const rows = (sql: string, params: unknown[] = []) => {
    const st = db.prepare(sql);
    st.setReturnArrays(true);
    return st.all(...(params as never[])) as unknown as Rows;
  };
  const core = nodeRustCore();
  core.runSync('migrateOrgSchema', {}, undefined, rows);
  await core.run('createPresentation', { id: 'P', name: 'Söndag', eventDate: '2026-11-29', time: '11:00', location: 'Kyrksalen', description: 'Advent' }, admin, rows);
  db.exec(`UPDATE presentations SET theme_id = 'light' WHERE id = 'P'`);
  db.exec(`INSERT INTO presentations (id, name, is_template, weekday, time, location) VALUES ('T', 'Gudstjänst', 1, 0, '11:00', 'Kyrkan')`);
  for (const id of ['t1', 't2']) await core.run('addHeaderToPresentation', { itemId: id, presentationId: 'T', title: id }, admin, rows);
  const first = await core.view<DetailsStep>('detailsStepView', { init }, rows);
  const after = async (events: DetailsEvent[]) => {
    let s = first;
    for (const event of events) s = await core.view<DetailsStep>('detailsStepView', { state: s.state, event, now: 5000 }, rows);
    return s;
  };
  return { first, after };
}

const confirm = (s: DetailsStep) => s.view.actions.find((a) => a.role === 'confirm')!;

describe('detailsStepView, Redigera detaljer', () => {
  it('opens with the presentation as it is', async () => {
    const { first } = await dialog({ presentationId: 'P' });

    expect(first.state).toMatchObject({ mode: 'edit', name: 'Söndag', eventDate: '2026-11-29', time: '11:00', location: 'Kyrksalen', description: 'Advent', themeId: 'light' });
  });

  it('asks for the theme, and says Spara', async () => {
    const { first } = await dialog({ presentationId: 'P' });

    expect([first.view.title, first.view.groups.flat().includes('themeId'), confirm(first).text]).toEqual(['presentation.editDetails', true, 'common.save']);
  });

  it('cuts a name to its most characters', async () => {
    const { after } = await dialog({ presentationId: 'P' });

    const out = await after([{ type: 'set', field: 'name', value: 'x'.repeat(250) }]);

    expect(out.state.name.length).toBe(out.view.nameMax);
  });

  it('runs the change trimmed, an empty field null, and closes at once', async () => {
    const { after } = await dialog({ presentationId: 'P' });

    const out = await after([{ type: 'set', field: 'name', value: '  Advent  ' }, { type: 'set', field: 'location', value: ' ' }, { type: 'set', field: 'time', value: '' }, { type: 'save' }]);

    expect(out.effects).toEqual([
      { type: 'run', command: 'updatePresentation', args: { id: 'P', name: 'Advent', eventDate: '2026-11-29', time: null, location: null, description: 'Advent' } },
      { type: 'close' },
    ]);
  });

  it('sends the theme only when it changed', async () => {
    const { after } = await dialog({ presentationId: 'P' });

    const out = await after([{ type: 'set', field: 'themeId', value: '' }, { type: 'save' }]);

    expect(out.effects[0]).toMatchObject({ type: 'run', args: { themeId: null } });
  });

  it('may not be saved without a name', async () => {
    const { after } = await dialog({ presentationId: 'P' });

    const out = await after([{ type: 'set', field: 'name', value: '   ' }, { type: 'save' }]);

    expect([confirm(out).enabled, out.effects]).toEqual([false, []]);
  });

  it('saves on ↵ in the name', async () => {
    const { after } = await dialog({ presentationId: 'P' });

    const out = await after([{ type: 'enter', field: 'name' }]);

    expect(out.effects.map((e) => e.type)).toEqual(['run', 'close']);
  });

  it('does nothing on ↵ in the place', async () => {
    const { after } = await dialog({ presentationId: 'P' });

    const out = await after([{ type: 'enter', field: 'location' }]);

    expect(out.effects).toEqual([]);
  });

  it('closes on Avbryt with nothing run', async () => {
    const { after } = await dialog({ presentationId: 'P' });

    const out = await after([{ type: 'set', field: 'name', value: 'Annat' }, { type: 'cancel' }]);

    expect(out.effects).toEqual([{ type: 'close' }]);
  });
});

describe('detailsStepView, Skapa presentation', () => {
  it('opens blank with the shell word for its name, no theme asked', async () => {
    const { first } = await dialog({ defaultName: 'Presentation' });

    expect([first.state.name, first.view.groups.flat().includes('themeId'), confirm(first).text]).toEqual(['Presentation', false, 'common.create']);
  });

  it('runs createPresentation with the id the shell gives, and waits', async () => {
    const { after } = await dialog({ defaultName: 'Presentation' });

    const out = await after([{ type: 'save', id: 'N' }]);

    expect([out.effects, out.state.saving, confirm(out).enabled]).toEqual([[{ type: 'run', command: 'createPresentation', args: { id: 'N', name: 'Presentation', eventDate: null, time: null, location: null, description: null } }], true, false]);
  });

  it('does not run twice while it works', async () => {
    const { after } = await dialog({ defaultName: 'Presentation' });

    const out = await after([{ type: 'save', id: 'N' }, { type: 'save', id: 'M' }]);

    expect(out.effects).toEqual([]);
  });

  it('closes and opens the presentation made once its change ran', async () => {
    const { after } = await dialog({ defaultName: 'Presentation' });

    const out = await after([{ type: 'save', id: 'N' }, { type: 'done', ok: true }]);

    expect(out.effects).toEqual([{ type: 'close' }, { type: 'open', presentationId: 'N' }]);
  });

  it('stays open for another try when its change was refused', async () => {
    const { after } = await dialog({ defaultName: 'Presentation' });

    const out = await after([{ type: 'save', id: 'N' }, { type: 'done', ok: false }]);

    expect([out.effects, out.state.saving, confirm(out).enabled]).toEqual([[], false, true]);
  });
});

describe('detailsStepView, Skapa from a template', () => {
  it("opens with its name, next date, time and place", async () => {
    const { first } = await dialog({ templateId: 'T', today: '2026-11-23', now: '09:00' });

    expect(first.state).toMatchObject({ mode: 'template', name: 'Gudstjänst', eventDate: '2026-11-29', time: '11:00', location: 'Kyrkan' });
  });

  it('copies its items, each with an id of its own, and marks it used', async () => {
    const { after } = await dialog({ templateId: 'T', today: '2026-11-23', now: '09:00' });

    const out = await after([{ type: 'save', id: 'N' }]);

    expect(out.effects[0]).toMatchObject({ type: 'run', command: 'createFromTemplate', args: { id: 'N', templateId: 'T', items: [{ from: 't1', id: 'N-0' }, { from: 't2', id: 'N-1' }], at: 5000 } });
  });
});
