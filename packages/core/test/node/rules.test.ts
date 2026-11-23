// The fields' rules the web reads (FIELD_RULES, mutation.ts) against what the mutators take: one truth, held so by
// this test. A length is in characters (code points, chars.ts), an emoji one.
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { FIELD_RULES } from '@gp/core';
import { Core, runMutation, type Rows } from '../../src/core.ts';

/** An organisation's database in memory with a presentation `p1` and its heading `i1`, and a mutator run over it. */
function org() {
  const db = new DatabaseSync(':memory:');
  const all = (sql: string, params: unknown[] = []) => {
    const st = db.prepare(sql);
    st.setReturnArrays(true);
    return st.all(...(params as never[])) as unknown as Rows;
  };
  const core = new Core();
  core.runSync('migrateOrgSchema', all);
  const mutate = (name: string, args: object) => runMutation({ core, rows: all }, name, args, { userId: 'u', role: 'admin', now: 1000 });
  return { mutate, ready: mutate('createPresentation', { id: 'p1', name: 'Söndag' }).then(() => mutate('addHeaderToPresentation', { itemId: 'i1', presentationId: 'p1', title: 'Lovsång' })) };
}

type Field = 'presentationName' | 'itemTitle' | 'itemNote' | 'location' | 'description';

/** Each field's mutator, setting it to `text`. */
const SETTERS: Record<Field, (text: string) => [string, object]> = {
  presentationName: (text) => ['updatePresentation', { id: 'p1', name: text }],
  itemTitle: (text) => ['renameItem', { itemId: 'i1', title: text }],
  itemNote: (text) => ['setItemNote', { itemId: 'i1', note: text }],
  location: (text) => ['updatePresentation', { id: 'p1', location: text }],
  description: (text) => ['updatePresentation', { id: 'p1', description: text }],
};

describe('FIELD_RULES', () => {
  /** Each field's rule: a presentation's name and an item's title are names. */
  const RULES: Record<Field, { required: boolean; max: number }> = {
    presentationName: FIELD_RULES.name,
    itemTitle: FIELD_RULES.name,
    itemNote: FIELD_RULES.itemNote,
    location: FIELD_RULES.location,
    description: FIELD_RULES.description,
  };
  const fields = () => RULES;

  it.each(Object.keys(SETTERS) as Field[])('lets %s take its most characters, as its mutator does', async (field) => {
    const { mutate, ready } = org();
    await ready;
    const [name, args] = SETTERS[field]('x'.repeat(fields()[field].max));

    const saved = mutate(name, args);

    await expect(saved).resolves.toBeUndefined();
  });

  it.each(Object.keys(SETTERS) as Field[])('refuses %s one character over its most, as its mutator does', async (field) => {
    const { mutate, ready } = org();
    await ready;
    const [name, args] = SETTERS[field]('x'.repeat(fields()[field].max + 1));

    const saved = mutate(name, args);

    await expect(saved).rejects.toMatchObject({ code: 'invalid-args' });
  });

  it.each(Object.keys(SETTERS) as Field[])('counts %s in characters, so its most in emoji is taken', async (field) => {
    const { mutate, ready } = org();
    await ready;
    const [name, args] = SETTERS[field]('😀'.repeat(fields()[field].max));

    const saved = mutate(name, args);

    await expect(saved).resolves.toBeUndefined();
  });

  it.each(Object.keys(SETTERS) as Field[])('refuses %s one emoji over its most', async (field) => {
    const { mutate, ready } = org();
    await ready;
    const [name, args] = SETTERS[field]('😀'.repeat(fields()[field].max + 1));

    const saved = mutate(name, args);

    await expect(saved).rejects.toMatchObject({ code: 'invalid-args' });
  });

  it.each(Object.keys(SETTERS) as Field[])('takes %s empty exactly when it is not required', async (field) => {
    const { mutate, ready } = org();
    await ready;
    const [name, args] = SETTERS[field]('  ');

    const saved = mutate(name, args).then(() => 'taken', () => 'refused');

    expect(await saved).toBe(fields()[field].required ? 'refused' : 'taken');
  });
});
