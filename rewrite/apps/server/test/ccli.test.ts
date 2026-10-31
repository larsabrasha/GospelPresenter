// The CCLI report's mutators (spec 02 SONG-R48–R52, SONG-A32–A36, decided on 2026-10-31), run on a server database.
import { describe, expect, it } from 'vitest';
import { getMutator, type MutatorName, type Role, type Tx } from '@gp/core';
import { nodeOrgStore, openSqlite } from '../src/node.ts';

function org() {
  const store = nodeOrgStore(openSqlite(':memory:', 'node:sqlite'));
  const run = (name: MutatorName, args: unknown, role: Role = 'admin') =>
    store.transaction(() => getMutator(name)!.run(store.db as Tx, getMutator(name)!.args.parse(args), { userId: 'u', role, now: 1 }));
  const entries = () => store.query('SELECT song_name, ccli, presentation_name, date, reported_at FROM ccli_entries ORDER BY id');
  return { run, entries };
}

const shown = (o: Partial<{ songId: string; songName: string; ccli: string; presentationId: string; presentationName: string; date: string }> = {}) => ({
  songId: 'S',
  songName: 'Amazing Grace',
  ccli: '12345',
  presentationId: 'P',
  presentationName: 'Gudstjänst',
  date: '2026-11-01',
  ...o,
});

describe('recording a song shown live', () => {
  it('SONG-A33: records nothing while collection is off', async () => {
    const o = org();

    await o.run('recordCcliUse', shown());

    expect(o.entries()).toEqual([]);
  });

  it('SONG-A34: records the song, its number, the presentation and the day once collection is on', async () => {
    const o = org();
    await o.run('setCcliCollection', { on: true });

    await o.run('recordCcliUse', shown());

    expect(o.entries()).toEqual([{ song_name: 'Amazing Grace', ccli: '12345', presentation_name: 'Gudstjänst', date: '2026-11-01', reported_at: null }]);
  });

  it('SONG-A34: adds nothing for the same song shown again the same day in the same presentation', async () => {
    const o = org();
    await o.run('setCcliCollection', { on: true });
    await o.run('recordCcliUse', shown());

    await o.run('recordCcliUse', shown({ songName: 'Renamed since' }));

    expect(o.entries()).toHaveLength(1);
  });

  it('SONG-A34: adds an entry for another presentation, and for another day', async () => {
    const o = org();
    await o.run('setCcliCollection', { on: true });
    await o.run('recordCcliUse', shown());

    await o.run('recordCcliUse', shown({ presentationId: 'P2' }));
    await o.run('recordCcliUse', shown({ date: '2026-11-08' }));

    expect(o.entries()).toHaveLength(3);
  });

  it('SONG-A35: never records a song without a CCLI number', async () => {
    const o = org();
    await o.run('setCcliCollection', { on: true });

    await o.run('recordCcliUse', shown({ ccli: '  ' }));

    expect(o.entries()).toEqual([]);
  });

  it('records for a user who presents', async () => {
    const o = org();
    await o.run('setCcliCollection', { on: true });

    await o.run('recordCcliUse', shown(), 'user');

    expect(o.entries()).toHaveLength(1);
  });

  it('records nothing once collection is switched off again', async () => {
    const o = org();
    await o.run('setCcliCollection', { on: true });
    await o.run('setCcliCollection', { on: false });

    await o.run('recordCcliUse', shown());

    expect(o.entries()).toEqual([]);
  });
});

describe('marking entries reported', () => {
  it('SONG-A36: marks the entries reported at the given time, and not reported again', async () => {
    const o = org();
    await o.run('setCcliCollection', { on: true });
    await o.run('recordCcliUse', shown());
    await o.run('recordCcliUse', shown({ songId: 'S2' }));
    const ids = ['S|2026-11-01|P', 'S2|2026-11-01|P'];

    await o.run('setCcliReported', { ids, reported: true, at: 500 });
    const marked = o.entries().map((e) => e.reported_at);
    await o.run('setCcliReported', { ids, reported: false, at: 600 });

    expect([marked, o.entries().map((e) => e.reported_at)]).toEqual([
      [500, 500],
      [null, null],
    ]);
  });

  it('SONG-A32: refuses a user marking entries or switching collection', async () => {
    const o = org();

    await expect(o.run('setCcliReported', { ids: ['x'], reported: true, at: 1 }, 'user')).rejects.toThrow('may not');
    await expect(o.run('setCcliCollection', { on: true }, 'user')).rejects.toThrow('may not');
  });
});
