import { describe, expect, it } from 'vitest';
import { t } from '../src/i18n.ts';
import { href, parseRoute, type Route } from '../src/ui/router.ts';

describe('routes', () => {
  it('every route survives a round trip through its hash', () => {
    const routes: Route[] = [
      { page: 'songs' },
      { page: 'song', id: 'a b/c' },
      { page: 'presentations' },
      { page: 'presentation', id: 'P1' },
      { page: 'live', id: 'P1' },
      { page: 'trash', kind: null },
      { page: 'trash', kind: 'Song' },
      { page: 'output' },
      { page: 'users' },
      { page: 'devices' },
      { page: 'invite', token: 'gpin_abc-_123' },
      { page: 'signedIn' },
      { page: 'signIn', error: null },
      { page: 'signIn', error: 'not-linked' },
    ];
    for (const r of routes) expect(parseRoute(href(r))).toEqual(r);
  });

  it('the trash kind is case-insensitive, and an unknown kind is everything', () => {
    expect(parseRoute('#/trash?kind=presentation')).toEqual({ page: 'trash', kind: 'Presentation' });
    expect(parseRoute('#/trash?kind=Image')).toEqual({ page: 'trash', kind: null });
    expect(parseRoute('#/trash?kind=')).toEqual({ page: 'trash', kind: null });
  });

  it('an unknown hash goes to the song list', () => {
    expect(parseRoute('#/nowhere')).toEqual({ page: 'songs' });
    expect(parseRoute('')).toEqual({ page: 'songs' });
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
    expect(errorText({ error: 'something-new', body: null })).toBe('Något gick fel. Försök igen.');
  });
});
