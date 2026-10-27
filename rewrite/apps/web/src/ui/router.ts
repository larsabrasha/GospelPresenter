import { useEffect, useState } from 'react';

// Path routes through the History API (`/songs`, `/admin/images`, ...). The
// server answers every address that is not a file or an API path with the
// app's index.html, so a reload or a pasted link lands on the right page.
// Pages that would collide with an API prefix (`/users`, `/bibles/`) live
// under `/admin/`, as in the current app. Secrets stay in the fragment, which
// no server sees: an invite is `/invite#{token}`.

/** The kinds the trash holds so far, in the order the filter shows them (spec 03 section 5). */
export const TRASH_KINDS = ['Presentation', 'Song', 'Image'] as const;
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
  | { page: 'bibles' }
  | { page: 'images' }
  | { page: 'themes' }
  /** The signed-in user's own ways to sign in; `error` when linking Google was refused. */
  | { page: 'logins'; error: string | null }
  /** An invite link (spec 01 `/invite/{token}`): the token stays in the fragment, which is never sent to a server. */
  | { page: 'invite'; token: string }
  /** Back from Google on the web: the page collects its session (`POST /auth/google/finish`). */
  | { page: 'signedIn' }
  /** Back from a refused sign-in, with the server's error code. */
  | { page: 'signIn'; error: string | null }
  | { page: 'output' };

/** Where the browser is now. */
export function currentRoute(): Route {
  return parseRoute(location.pathname, location.search, location.hash);
}

/** An address as the router reads it: the path and query, and the fragment, which only an invite's token uses. */
export function parseRoute(path: string, search = '', hash = ''): Route {
  const [first = '', second, third] = path.replace(/^\/+|\/+$/g, '').split('/').map(decodeURIComponent);
  const query = new URLSearchParams(search);
  if (first === 'admin') {
    if (second === 'users') return { page: 'users' };
    if (second === 'devices') return { page: 'devices' };
    if (second === 'bibles') return { page: 'bibles' };
    if (second === 'images') return { page: 'images' };
    if (second === 'themes') return { page: 'themes' };
    return { page: 'songs' };
  }
  const id = second;
  void third;
  if (first === 'trash') {
    // `?kind=` is case-insensitive; an unknown kind means everything.
    const kind = query.get('kind')?.toLowerCase();
    return { page: 'trash', kind: TRASH_KINDS.find((k) => k.toLowerCase() === kind) ?? null };
  }
  if (first === 'songs' && id) return { page: 'song', id };
  if (first === 'presentations' && id) return { page: 'presentation', id };
  if (first === 'live' && id) return { page: 'live', id };
  if (first === 'invite' && hash.length > 1) return { page: 'invite', token: decodeURIComponent(hash.slice(1)) };
  if (first === 'signed-in') return { page: 'signedIn' };
  if (first === 'signin') return { page: 'signIn', error: query.get('error') };
  if (first === 'output') return { page: 'output' };
  if (first === 'logins') return { page: 'logins', error: query.get('error') };
  if (first === 'presentations') return { page: 'presentations' };
  return { page: 'songs' };
}

const ADMIN_PAGES = new Set(['users', 'devices', 'bibles', 'images', 'themes']);

export function href(r: Route): string {
  switch (r.page) {
    case 'song':
      return `/songs/${encodeURIComponent(r.id)}`;
    case 'presentation':
      return `/presentations/${encodeURIComponent(r.id)}`;
    case 'live':
      return `/live/${encodeURIComponent(r.id)}`;
    case 'trash':
      return r.kind ? `/trash?kind=${r.kind}` : '/trash';
    case 'invite':
      return `/invite#${encodeURIComponent(r.token)}`;
    case 'signedIn':
      return '/signed-in';
    case 'signIn':
      return r.error ? `/signin?error=${encodeURIComponent(r.error)}` : '/signin';
    case 'logins':
      return r.error ? `/logins?error=${encodeURIComponent(r.error)}` : '/logins';
    default:
      return ADMIN_PAGES.has(r.page) ? `/admin/${r.page}` : `/${r.page}`;
  }
}

const NAVIGATED = 'gp:navigate';

export function navigate(r: Route) {
  history.pushState(null, '', href(r));
  dispatchEvent(new Event(NAVIGATED));
}

/** Paths the server answers itself: a link to one is a real navigation, not a page of the app. */
const SERVER_PATHS = /^\/(auth|sync|bibles|media|pair|debug|app-login|users)(\/|$|\?)/;

/**
 * Turns clicks on same-origin links into History navigation, so `<a href>`
 * moves between pages without a reload. Modified clicks, other targets and
 * the server's own paths are left to the browser. Install once.
 */
export function installLinkHandler(): void {
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target instanceof Element ? e.target.closest('a[href]') : null;
    if (!a || (a.getAttribute('target') && a.getAttribute('target') !== '_self') || a.hasAttribute('download')) return;
    const url = new URL((a as HTMLAnchorElement).href, location.href);
    if (url.origin !== location.origin || SERVER_PATHS.test(url.pathname)) return;
    e.preventDefault();
    history.pushState(null, '', url.pathname + url.search + url.hash);
    dispatchEvent(new Event(NAVIGATED));
  });
}

export function useRoute(): Route {
  const [route, setRoute] = useState(currentRoute);
  useEffect(() => {
    const on = () => setRoute(currentRoute());
    addEventListener('popstate', on);
    addEventListener(NAVIGATED, on);
    return () => {
      removeEventListener('popstate', on);
      removeEventListener(NAVIGATED, on);
    };
  }, []);
  return route;
}
