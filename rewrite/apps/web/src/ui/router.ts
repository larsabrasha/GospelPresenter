import { useEffect, useState } from 'react';

// Path routes through the History API (`/songs`, `/admin/images`, ...). The
// server answers every address that is not a file or an API path with the
// app's index.html, so a reload or a pasted link lands on the right page.
// The server's own paths are all under `/api/`, so no page can collide with
// one. The presentations are the start page, `/`. Admin pages, the songs among them, live under
// `/admin/`, as in the current app; `/songs` from before still opens them. Secrets stay in the
// fragment, which no server sees: an invite is `/invite#{token}`.

/** The kinds the trash holds so far, in the order the filter shows them (spec 03 section 5). */
export const TRASH_KINDS = ['Presentation', 'Template', 'Song', 'Image', 'Audio'] as const;
export type TrashKind = (typeof TRASH_KINDS)[number];

export type Route =
  | { page: 'songs' }
  | { page: 'song'; id: string }
  | { page: 'presentations' }
  | { page: 'presentation'; id: string }
  /** The templates page, under the admin menu (spec 03 screen 3). */
  | { page: 'templates' }
  /** A template in the presentation editor (`/templates/{id}`, spec 03 screen 2). */
  | { page: 'template'; id: string }
  /** The live view: this window's own session, or with `remote` a session elsewhere (spec 04 §2), `session` naming which. */
  | { page: 'live'; id: string; remote?: boolean; session?: string | null }
  | { page: 'trash'; kind: TrashKind | null }
  | { page: 'users' }
  | { page: 'devices' }
  | { page: 'bibles' }
  | { page: 'images' }
  | { page: 'audios' }
  | { page: 'overlays' }
  | { page: 'overlay'; id: string }
  | { page: 'displays' }
  /** A public output (spec 04 §6): anonymous, no database. */
  | { page: 'watch'; code: string }
  /**
   * A paired screen (spec 04 §5): anonymous, no database. `id` and `name` for
   * a saved screen (`/display?id={code}&name={name}`); without them a
   * temporary screen, which `token` (from the operator's QR code) pairs at once.
   */
  | { page: 'display'; id: string | null; name: string | null; token: string | null }
  | { page: 'themes' }
  /** The user's own settings on this device: the colour theme. */
  | { page: 'settings' }
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

/**
 * A path segment as text. A link cut off in a message can end in half a
 * percent escape, which `decodeURIComponent` refuses with an error; such a
 * segment is kept as it was rather than stopping the app from starting.
 */
function decode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** An address as the router reads it: the path and query, and the fragment, which only an invite's token uses. */
export function parseRoute(path: string, search = '', hash = ''): Route {
  const [first = '', second, third] = path.replace(/^\/+|\/+$/g, '').split('/').map(decode);
  const query = new URLSearchParams(search);
  if (first === 'admin') {
    if (second === 'songs') return third ? { page: 'song', id: third } : { page: 'songs' };
    if (second === 'users') return { page: 'users' };
    if (second === 'devices') return { page: 'devices' };
    if (second === 'bibles') return { page: 'bibles' };
    if (second === 'images') return { page: 'images' };
    if (second === 'audios') return { page: 'audios' };
    if (second === 'overlays') return third ? { page: 'overlay', id: third } : { page: 'overlays' };
    if (second === 'templates') return { page: 'templates' };
    if (second === 'themes') return { page: 'themes' };
    if (second === 'displays') return { page: 'displays' };
    return { page: 'songs' };
  }
  const id = second;
  if (first === 'trash') {
    // `?kind=` is case-insensitive; an unknown kind means everything.
    const kind = query.get('kind')?.toLowerCase();
    return { page: 'trash', kind: TRASH_KINDS.find((k) => k.toLowerCase() === kind) ?? null };
  }
  if (first === 'songs' && id) return { page: 'song', id };
  if (first === 'presentations' && id) return { page: 'presentation', id };
  if (first === 'templates' && id) return { page: 'template', id };
  if (first === 'live' && id) {
    if (query.get('remote') !== '1') return { page: 'live', id };
    return { page: 'live', id, remote: true, session: query.get('session') };
  }
  if (first === 'invite' && hash.length > 1) return { page: 'invite', token: decode(hash.slice(1)) };
  if (first === 'signed-in') return { page: 'signedIn' };
  if (first === 'signin') return { page: 'signIn', error: query.get('error') };
  if (first === 'output') return { page: 'output' };
  if (first === 'watch' && id) return { page: 'watch', code: id };
  if (first === 'display') return { page: 'display', id: query.get('id'), name: query.get('name'), token: query.get('token') };
  if (first === 'logins') return { page: 'logins', error: query.get('error') };
  if (first === 'settings') return { page: 'settings' };
  if (first === 'songs') return { page: 'songs' };
  return { page: 'presentations' };
}

const ADMIN_PAGES = new Set(['songs', 'users', 'devices', 'bibles', 'images', 'audios', 'overlays', 'templates', 'themes', 'displays']);

export function href(r: Route): string {
  switch (r.page) {
    case 'presentations':
      return '/';
    case 'song':
      return `/admin/songs/${encodeURIComponent(r.id)}`;
    case 'presentation':
      return `/presentations/${encodeURIComponent(r.id)}`;
    case 'overlay':
      return `/admin/overlays/${encodeURIComponent(r.id)}`;
    case 'template':
      return `/templates/${encodeURIComponent(r.id)}`;
    case 'live': {
      const path = `/live/${encodeURIComponent(r.id)}`;
      if (!r.remote) return path;
      return r.session ? `${path}?remote=1&session=${encodeURIComponent(r.session)}` : `${path}?remote=1`;
    }
    case 'trash':
      return r.kind ? `/trash?kind=${r.kind}` : '/trash';
    case 'watch':
      return `/watch/${encodeURIComponent(r.code)}`;
    case 'display': {
      const q = new URLSearchParams();
      if (r.id) q.set('id', r.id);
      if (r.name) q.set('name', r.name);
      if (r.token) q.set('token', r.token);
      return q.size ? `/display?${q}` : '/display';
    }
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
const SERVER_PATHS = /^\/api(\/|$)/;

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
