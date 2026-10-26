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
  if (page === 'output') return { page: 'output' };
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
