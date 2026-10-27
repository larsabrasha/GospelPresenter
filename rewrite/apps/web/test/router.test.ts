import { describe, expect, it } from 'vitest';
import { t } from '../src/i18n.ts';
import { href, parseRoute, type Route } from '../src/ui/router.ts';

/** Reads an address the way the app does: `useRoute` gives the router the path, the query and the fragment. */
const read = (address: string) => {
  const u = new URL(address, 'http://localhost');
  return parseRoute(u.pathname, u.search, u.hash);
};

describe('routes', () => {
  it('every route survives a round trip through its address', () => {
    const routes: Route[] = [
      { page: 'songs' },
      { page: 'song', id: 'a b/c' },
      { page: 'presentations' },
      { page: 'presentation', id: 'P1' },
      { page: 'live', id: 'P1' },
      { page: 'trash', kind: null },
      { page: 'trash', kind: 'Song' },
      { page: 'trash', kind: 'Image' },
      { page: 'output' },
      { page: 'users' },
      { page: 'devices' },
      { page: 'bibles' },
      { page: 'images' },
      { page: 'themes' },
      { page: 'logins', error: null },
      { page: 'logins', error: 'login-taken' },
      { page: 'invite', token: 'gpin_abc-_123' },
      { page: 'signedIn' },
      { page: 'signIn', error: null },
      { page: 'signIn', error: 'not-linked' },
    ];
    for (const r of routes) expect(read(href(r)), href(r)).toEqual(r);
  });

  it('addresses are plain paths, with no # except an invite\'s token', () => {
    expect(href({ page: 'songs' })).toBe('/songs');
    expect(href({ page: 'presentation', id: 'P1' })).toBe('/presentations/P1');
    expect(href({ page: 'images' })).toBe('/admin/images');
    expect(href({ page: 'trash', kind: 'Image' })).toBe('/trash?kind=Image');
    // The token is in the fragment, which no server sees, never in the path (it would reach a log).
    expect(href({ page: 'invite', token: 'gpin_x' })).toBe('/invite#gpin_x');
    expect(read('/invite')).toEqual({ page: 'songs' }); // an invite page without its token is nothing
    expect(read('/invite/gpin_x')).toEqual({ page: 'songs' });
  });

  it('admin pages live under /admin, so none collides with an API path (/users, /bibles/)', () => {
    for (const page of ['users', 'devices', 'bibles', 'images', 'themes'] as const) {
      const path = href({ page });
      expect(path).toBe(`/admin/${page}`);
      expect(path).not.toMatch(/^\/(users|bibles|media|pair)/);
    }
    expect(read('/users')).toEqual({ page: 'songs' });
    expect(read('/admin/nowhere')).toEqual({ page: 'songs' });
  });

  it('the trash kind is case-insensitive, and an unknown kind is everything', () => {
    expect(read('/trash?kind=presentation')).toEqual({ page: 'trash', kind: 'Presentation' });
    expect(read('/trash?kind=IMAGE')).toEqual({ page: 'trash', kind: 'Image' });
    expect(read('/trash?kind=Audio')).toEqual({ page: 'trash', kind: null }); // audio is not built yet
    expect(read('/trash?kind=')).toEqual({ page: 'trash', kind: null });
  });

  it('an unknown address goes to the song list; a trailing slash does not matter', () => {
    expect(read('/nowhere')).toEqual({ page: 'songs' });
    expect(read('/')).toEqual({ page: 'songs' });
    expect(read('/presentations/')).toEqual({ page: 'presentations' });
  });

  it('Inloggningsmetoder, with the error a refused Google link comes back with', () => {
    expect(read('/logins')).toEqual({ page: 'logins', error: null });
    expect(read('/logins?error=login-taken')).toEqual({ page: 'logins', error: 'login-taken' });
    expect(href({ page: 'logins', error: 'login-taken' })).toBe('/logins?error=login-taken');
  });
});

describe('text', () => {
  it('fills placeholders and leaves unknown ones visible', () => {
    expect(t('status.pending', { n: 3 })).toBe('3 ändringar väntar');
    expect(t('status.pending')).toBe('{n} ändringar väntar');
  });
});

describe('auth error texts', () => {
  it('every refusal has a Swedish text; a lock says how long; anything else is the generic one', async () => {
    const { errorText } = await import('../src/auth/errors.ts');
    expect(errorText({ error: 'not-linked', body: null })).toBe('Det här Google-kontot är inte kopplat till någon användare. Be din administratör om en inbjudan.');
    expect(errorText({ error: 'too-many-attempts', body: { retryAfter: 61 } })).toBe('För många misslyckade försök. Vänta 2 min och försök igen.');
    expect(errorText({ error: 'pair-code-invalid', body: null })).toBe('Ogiltig eller utgången kod');
    expect(errorText({ error: 'last-login', body: null })).toBe('Du kan inte ta bort ditt sista sätt att logga in.');
    expect(errorText({ error: 'passkey-failed', body: null })).toBe('Passkeyn kunde inte användas. Försök igen.');
    expect(errorText({ error: 'something-new', body: null })).toBe('Något gick fel. Försök igen.');
  });
});
