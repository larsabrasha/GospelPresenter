import { describe, expect, it } from 'vitest';
import { t } from '../src/i18n.ts';
import { isOpen, MINE, searchSettings, settingsGroups } from '../src/pages/settings/settingsLinks.ts';

const labels = (role: 'user' | 'admin' | 'superAdmin', host = false) => settingsGroups({ role }, host).flatMap((g) => g.links.map((l) => l.label));

describe('settingsGroups', () => {
  it('an admin sees the four groups, then Papperskorg and Om Gospel Presenter apart', () => {
    const groups = settingsGroups({ role: 'admin' }, false);
    expect(groups.map((g) => g.title)).toEqual(['settings.group.library', 'settings.group.presentation', 'settings.group.display', 'settings.group.church', null, null]);
    expect(groups.slice(-2).map((g) => g.links.map((l) => l.label))).toEqual([['nav.trash'], ['nav.about']]);
  });

  it('only a SuperAdmin sees Organisationer', () => {
    expect(labels('admin')).not.toContain('nav.orgs');
    expect(labels('superAdmin')).toContain('nav.orgs');
  });

  it('Enheter shows only on the host', () => {
    expect(labels('admin', false)).not.toContain('nav.devices');
    expect(labels('admin', true)).toContain('nav.devices');
  });

  it('a user sees no page they may not open, such as Organisationer', () => {
    expect(labels('user')).not.toContain('nav.orgs');
  });

  it('Mallar is not in the list for anyone: it is a page of its own, reached from Skapa presentation', () => {
    expect(labels('superAdmin')).not.toContain('nav.templates');
  });
});

describe('isOpen', () => {
  const songs = settingsGroups({ role: 'admin' }, false)[0]!.links[0]!;

  it('a song open marks Sånger', () => {
    expect(isOpen(songs, { page: 'song', id: 'S1' })).toBe(true);
  });

  it('the list alone marks Sånger, which a computer shows beside it', () => {
    expect(isOpen(songs, { page: 'admin' })).toBe(true);
  });

  it('the sign-in methods mark Mina inställningar', () => {
    expect(isOpen(MINE, { page: 'logins', error: null })).toBe(true);
  });

  it('Lagring marks Mina inställningar', () => {
    expect(isOpen(MINE, { page: 'storage' })).toBe(true);
  });
});

describe('searchSettings', () => {
  const groups = settingsGroups({ role: 'admin' }, false);
  const found = (query: string) => searchSettings(groups, query, t).map((l) => l.label);

  it('finds a row by its name, whatever the case', () => {
    expect(found('sÅNG')).toContain('nav.songs');
  });

  it('finds a row by a word of its own that its name does not hold', () => {
    expect(found('projektor')).toEqual(['nav.displays']);
  });

  it("finds what Mina inställningar holds, such as Språk", () => {
    expect(found('språk')).toEqual(['settings.language']);
  });

  it('says where a result from Mina inställningar lives, and nothing for a row of the list', () => {
    const [language] = searchSettings(groups, 'språk', t);
    const [displays] = searchSettings(groups, 'projektor', t);
    expect([language?.where, displays?.where]).toEqual(['nav.settings', undefined]);
  });

  it('needs every word of the query', () => {
    expect(found('qr länk')).toEqual(['displays.public']);
  });

  it('finds no row the user may not open', () => {
    expect(searchSettings(settingsGroups({ role: 'admin' }, false), 'organisationer', t).map((l) => l.label)).not.toContain('nav.orgs');
  });

  it('finds nothing for an empty query', () => {
    expect(found('  ')).toEqual([]);
  });
});
