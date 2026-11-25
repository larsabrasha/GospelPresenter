// A song made in the add dialog is a draft until Skapa (Lars, 2026-11-25): kept as it is typed, in no list until then,
// and gone with Avbryt.
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { MutatorCtx } from '@gp/core';
import { Core, runMutation, type MutationDb, type Rows } from '../../src/core.ts';

const admin: MutatorCtx = { userId: 'u', role: 'admin', now: 1000 };

/** An organisation's database in memory, migrated by the core, and a core over it. */
function org(): MutationDb & { db0: DatabaseSync } {
  const db0 = new DatabaseSync(':memory:');
  const rows = (sql: string, params: unknown[] = []) => {
    const st = db0.prepare(sql);
    st.setReturnArrays(true);
    return st.all(...(params as never[])) as unknown as Rows;
  };
  const core = new Core();
  core.runSync('migrateOrgSchema', rows);
  return { db0, core, rows };
}

/** The library's song names, as Sånger and the add dialog list it. */
const library = async (o: MutationDb) => (await o.core.view<{ name: string }[]>('songsView', {}, async (sql, params) => o.rows(sql, params))).map((s) => s.name);

describe('song drafts', () => {
  it('keeps a draft out of the library', async () => {
    const o = org();

    await runMutation(o, 'createSong', { id: 's1', name: 'Utkast', draft: true }, admin);

    expect(await library(o)).toEqual([]);
  });

  it('brings a draft into the library with Skapa', async () => {
    const o = org();
    await runMutation(o, 'createSong', { id: 's1', name: 'Ny sång', draft: true }, admin);

    await runMutation(o, 'publishSong', { id: 's1' }, admin);

    expect(await library(o)).toEqual(['Ny sång']);
  });

  it('deletes a draft at once with Avbryt, not by way of the trash', async () => {
    const o = org();
    await runMutation(o, 'createSong', { id: 's1', name: 'Utkast', draft: true }, admin);
    await runMutation(o, 'addSongPart', { id: 'p1', songId: 's1', labelText: 'Verse 1', content: 'Text' }, admin);

    await runMutation(o, 'purgeSong', { id: 's1' }, admin);

    expect(o.db0.prepare('SELECT count(*) AS n FROM songs').get()).toEqual({ n: 0 });
  });

  it('still refuses to delete a song outside the trash at once', async () => {
    const o = org();
    await runMutation(o, 'createSong', { id: 's1', name: 'Sång' }, admin);

    await expect(runMutation(o, 'purgeSong', { id: 's1' }, admin)).rejects.toMatchObject({ code: 'not-in-trash' });
  });
});
