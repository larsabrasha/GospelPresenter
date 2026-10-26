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
      { page: 'output' },
    ];
    for (const r of routes) expect(parseRoute(href(r))).toEqual(r);
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
