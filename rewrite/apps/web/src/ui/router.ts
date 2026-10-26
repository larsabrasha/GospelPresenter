import { useEffect, useState } from 'react';

// Hash routes: the page works from any static host and from the desktop's
// embedded server without server-side routing.

/** The kinds the trash holds so far, in the order the filter shows them (spec 03 section 5). */
export const TRASH_KINDS = ['Presentation', 'Song'] as const;
export type TrashKind = (typeof TRASH_KINDS)[number];

export type Route =
  | { page: 'songs' }
  | { page: 'song'; id: string }
  | { page: 'presentations' }
  | { page: 'presentation'; id: string }
  | { page: 'live'; id: string }
  | { page: 'trash'; kind: TrashKind | null }
  | { page: 'users' }
  | { page: 'devices' }
  /** An invite link (spec 01 `/invite/{token}`): the token stays in the fragment, which is never sent to a server. */
  | { page: 'invite'; token: string }
  /** Back from Google on the web: the page collects its session (`POST /auth/google/finish`). */
  | { page: 'signedIn' }
  /** Back from a refused sign-in, with the server's error code. */
  | { page: 'signIn'; error: string | null }
  | { page: 'output' };

export function parseRoute(hash: string): Route {
  const [path = '', query = ''] = hash.replace(/^#\/?/, '').split('?');
  const [page, id] = path.split('/').map(decodeURIComponent);
  if (page === 'trash') {
    // `?kind=` is case-insensitive; an unknown kind means everything.
    const kind = new URLSearchParams(query).get('kind')?.toLowerCase();
    return { page: 'trash', kind: TRASH_KINDS.find((k) => k.toLowerCase() === kind) ?? null };
  }
  if (page === 'songs' && id) return { page: 'song', id };
  if (page === 'presentations' && id) return { page: 'presentation', id };
  if (page === 'live' && id) return { page: 'live', id };
  if (page === 'invite' && id) return { page: 'invite', token: id };
  if (page === 'signed-in') return { page: 'signedIn' };
  if (page === 'signin') return { page: 'signIn', error: new URLSearchParams(query).get('error') };
  if (page === 'output') return { page: 'output' };
  if (page === 'users') return { page: 'users' };
  if (page === 'devices') return { page: 'devices' };
  if (page === 'presentations') return { page: 'presentations' };
  return { page: 'songs' };
}

export function href(r: Route): string {
  switch (r.page) {
    case 'song':
      return `#/songs/${encodeURIComponent(r.id)}`;
    case 'presentation':
      return `#/presentations/${encodeURIComponent(r.id)}`;
    case 'live':
      return `#/live/${encodeURIComponent(r.id)}`;
    case 'trash':
      return r.kind ? `#/trash?kind=${r.kind}` : '#/trash';
    case 'invite':
      return `#/invite/${encodeURIComponent(r.token)}`;
    case 'signedIn':
      return '#/signed-in';
    case 'signIn':
      return r.error ? `#/signin?error=${encodeURIComponent(r.error)}` : '#/signin';
    default:
      return `#/${r.page}`;
  }
}

export function navigate(r: Route) {
  location.hash = href(r);
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(location.hash));
  useEffect(() => {
    const on = () => setRoute(parseRoute(location.hash));
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return route;
}
