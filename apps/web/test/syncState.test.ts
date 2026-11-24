import { describe, expect, it } from 'vitest';
import type { DbStatus } from '../src/db/protocol.ts';
import { initials, syncState } from '../src/ui/syncState.ts';

const synced: DbStatus = { storage: 'opfs', connected: true, syncing: false, pending: 0, updateRequired: false, authError: null, rejected: [] };

describe('syncState', () => {
  it('a page not yet connected is no problem yet', () => {
    expect(syncState({ ...synced, connected: false }, false)).toEqual({ problem: false, text: 'Synkar…' });
  });

  it('a synced device has no problem and says so', () => {
    expect(syncState(synced, false)).toEqual({ problem: false, text: 'Synkad' });
  });

  it('changes waiting a moment after a save are no problem yet', () => {
    expect(syncState({ ...synced, pending: 2 }, false)).toEqual({ problem: false, text: 'Synkar…' });
  });

  it('changes that have waited past the grace are a problem, with their number', () => {
    expect(syncState({ ...synced, pending: 3 }, true)).toEqual({ problem: true, text: '3 ändringar väntar' });
  });

  it('offline is a problem at once, with the changes that wait', () => {
    expect(syncState({ ...synced, connected: false, pending: 3 }, true)).toEqual({ problem: true, text: 'Offline · 3 ändringar väntar' });
  });

  it('one change waiting is said in the singular', () => {
    expect(syncState({ ...synced, pending: 1 }, true).text).toBe('1 ändring väntar');
  });

  it('offline with nothing waiting says only offline', () => {
    expect(syncState({ ...synced, connected: false }, true).text).toBe('Offline');
  });

  it('signed out, only the changes that wait are counted: the yellow line says to sign in again', () => {
    expect(syncState({ ...synced, connected: false, authError: 'unauthenticated', pending: 2 }, false)).toEqual({ problem: true, text: '2 ändringar väntar' });
  });

  it('signed out with nothing waiting is no problem for the bar, and the menu says to sign in again', () => {
    expect(syncState({ ...synced, connected: false, authError: 'unauthenticated' }, true)).toEqual({ problem: false, text: 'Logga in igen för att synka' });
  });

  it('an update the server needs is a problem', () => {
    expect(syncState({ ...synced, updateRequired: true }, false).problem).toBe(true);
  });
});

describe('initials', () => {
  it('takes the first and the last name', () => {
    expect(initials('Anna Maria Andersson')).toBe('AA');
  });

  it('takes one letter from a single name, upper case', () => {
    expect(initials('anna')).toBe('A');
  });

  it('a blank name gives a question mark', () => {
    expect(initials('  ')).toBe('?');
  });
});
