import { describe, expect, it } from 'vitest';
import { isOpen, MINE, settingsGroups } from '../src/pages/settings/settingsLinks.ts';

const labels = (role: 'user' | 'admin' | 'superAdmin', host = false) => settingsGroups({ role }, host).flatMap((g) => g.links.map((l) => l.label));

describe('settingsGroups', () => {
  it('an admin sees the four groups, then Om Gospel Presenter apart', () => {
    const groups = settingsGroups({ role: 'admin' }, false);
    expect(groups.map((g) => g.title)).toEqual(['settings.group.library', 'settings.group.presentation', 'settings.group.display', 'settings.group.church', null]);
    expect(groups.at(-1)!.links.map((l) => l.label)).toEqual(['nav.about']);
  });

  it('only a SuperAdmin sees Organisationer', () => {
    expect(labels('admin')).not.toContain('nav.orgs');
    expect(labels('superAdmin')).toContain('nav.orgs');
  });

  it('Enheter shows only on the host', () => {
    expect(labels('admin', false)).not.toContain('nav.devices');
    expect(labels('admin', true)).toContain('nav.devices');
  });

  it('a user sees no page they may not open, such as Mallar', () => {
    expect(labels('user')).not.toContain('nav.templates');
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
});
