import { useEffect, useState } from 'react';

// Path routes through the History API (`/songs`, `/admin/images`, ...). The
// server answers every address that is not a file or an API path with the
// app's index.html, so a reload or a pasted link lands on the right page.
// The server's own paths are all under `/api/`, so no page can collide with
// one. The presentations are the start page, `/`. Admin pages, the songs among them, live under
// `/admin/`, as in the current app; `/songs` from before still opens them. They and Mina inställningar
// open as Inställningar, in place of the page the user was on, which stays as it was under them
// (`isAdminPage`, `closeAdmin`; docs/layout-2-0.md). Secrets stay in the
// fragment, which no server sees: an invite is `/invite#{token}`.

/** The kinds the trash holds so far, in the order the filter shows them (spec 03 section 5). */
export const TRASH_KINDS = ['Presentation', 'Template', 'Song', 'Image', 'Audio', 'Video'] as const;
export type TrashKind = (typeof TRASH_KINDS)[number];

export type Route =
  /** Inställningar's list (`/admin`): alone on a phone; on a computer beside the songs. */
  | { page: 'admin' }
  | { page: 'songs' }
  | { page: 'song'; id: string }
  /** A song's history (`/admin/songs/{id}/history`, SongHistory.razor). */
  | { page: 'songHistory'; id: string }
  | { page: 'presentations' }
  /**
   * A presentation in its editor, which is also where it is presented, as Presentation.razor: presenting
   * when this window's session shows it; with `remote` driving a session elsewhere (spec 04 §2), `session`
   * naming which. An old link's `?stage=true` is left out: the stage view is gone (Lars, 2026-11-01).
   */
  | { page: 'presentation'; id: string; remote?: boolean; session?: string | null }
  /** The templates page, under the admin menu (spec 03 screen 3). */
  | { page: 'templates' }
  /** A template in the presentation editor (`/templates/{id}`, spec 03 screen 2). */
  | { page: 'template'; id: string }
  | { page: 'trash'; kind: TrashKind | null }
  | { page: 'users' }
  /** A user of the organisation (`/admin/users/{id}`, UserDetail.razor). */
  | { page: 'user'; id: string }
  | { page: 'devices' }
  | { page: 'bibles' }
  | { page: 'images' }
  | { page: 'audios' }
  | { page: 'videos' }
  | { page: 'overlays' }
  | { page: 'labels' }
  /** The CCLI report (`/admin/ccli-report`, CcliReport.razor). */
  | { page: 'ccliReport' }
  /** The SuperAdmin's organisations (`/admin/organizations`, Organizations.razor), and one of them. */
  | { page: 'orgs' }
  | { page: 'org'; id: string }
  | { page: 'overlay'; id: string }
  | { page: 'displays' }
  /** Publika utgångar, apart from Skärmar (Lars, 2026-11-02). */
  | { page: 'publicOutputs' }
  /** A public output (spec 04 §6): anonymous, no database. */
  | { page: 'watch'; code: string }
  /**
   * A paired screen (spec 04 §5): anonymous, no database. `id` and `name` for
   * a saved screen (`/display?id={code}&name={name}`); without them a
   * temporary screen, which `token` (from the operator's QR code) pairs at once.
   */
  | { page: 'display'; id: string | null; name: string | null; token: string | null }
  | { page: 'themes' }
  /** Om Gospel Presenter (`/admin/about`): the version, and links out. */
  | { page: 'about' }
  /** The organisation's settings (`/admin/settings`): remote control so far. */
  | { page: 'orgSettings' }
  /** The user's own settings on this device: the colour theme. */
  | { page: 'settings' }
  /** The signed-in user's own ways to sign in; `error` when linking Google was refused. */
  | { page: 'logins'; error: string | null }
  /** Lagring under Mina inställningar: what this device keeps, offline and in its cache. */
  | { page: 'storage' }
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
  const [first = '', second, third, fourth] = path.replace(/^\/+|\/+$/g, '').split('/').map(decode);
  const query = new URLSearchParams(search);
  if (first === 'admin') {
    if (second === 'songs') return third ? (fourth === 'history' ? { page: 'songHistory', id: third } : { page: 'song', id: third }) : { page: 'songs' };
    if (second === 'users') return third ? { page: 'user', id: third } : { page: 'users' };
    if (second === 'devices') return { page: 'devices' };
    if (second === 'bibles') return { page: 'bibles' };
    if (second === 'images') return { page: 'images' };
    if (second === 'audios') return { page: 'audios' };
    if (second === 'videos') return { page: 'videos' };
    if (second === 'overlays') return third ? { page: 'overlay', id: third } : { page: 'overlays' };
    // Mallar was a page of Inställningar until 2026-11-02; its old address still opens it.
    if (second === 'templates') return { page: 'templates' };
    if (second === 'labels') return { page: 'labels' };
    if (second === 'ccli-report') return { page: 'ccliReport' };
    if (second === 'organizations') return third ? { page: 'org', id: third } : { page: 'orgs' };
    if (second === 'themes') return { page: 'themes' };
    if (second === 'displays') return { page: 'displays' };
    if (second === 'public-outputs') return { page: 'publicOutputs' };
    if (second === 'settings') return { page: 'orgSettings' };
    if (second === 'about') return { page: 'about' };
    return second ? { page: 'songs' } : { page: 'admin' };
  }
  const id = second;
  if (first === 'trash') {
    // `?kind=` is case-insensitive; an unknown kind means everything.
    const kind = query.get('kind')?.toLowerCase();
    return { page: 'trash', kind: TRASH_KINDS.find((k) => k.toLowerCase() === kind) ?? null };
  }
  if (first === 'songs' && id) return { page: 'song', id };
  // `/live/{id}` was the address while presenting until 2026-10-30, with `remote=1`; its links still open.
  if ((first === 'presentations' || first === 'live') && id) {
    const remote = query.get('remote');
    if (remote !== 'true' && remote !== '1') return { page: 'presentation', id };
    return { page: 'presentation', id, remote: true, session: query.get('session') };
  }
  if (first === 'templates') return id ? { page: 'template', id } : { page: 'templates' };
  if (first === 'invite' && hash.length > 1) return { page: 'invite', token: decode(hash.slice(1)) };
  if (first === 'signed-in') return { page: 'signedIn' };
  if (first === 'signin') return { page: 'signIn', error: query.get('error') };
  if (first === 'output') return { page: 'output' };
  if (first === 'watch' && id) return { page: 'watch', code: id };
  if (first === 'display') return { page: 'display', id: query.get('id'), name: query.get('name'), token: query.get('token') };
  if (first === 'logins') return { page: 'logins', error: query.get('error') };
  if (first === 'settings') return { page: 'settings' };
  if (first === 'storage') return { page: 'storage' };
  if (first === 'songs') return { page: 'songs' };
  return { page: 'presentations' };
}

const ADMIN_PAGES = new Set<Route['page']>(['songs', 'users', 'devices', 'bibles', 'images', 'audios', 'videos', 'overlays', 'labels', 'ccliReport', 'themes', 'displays', 'publicOutputs', 'about']);

/** Inställningar's pages: those under `/admin/` and Mina inställningar, which open over the page the user was on. */
const ADMIN_DIALOG_PAGES = new Set<Route['page']>([...ADMIN_PAGES, 'admin', 'orgs', 'org', 'song', 'songHistory', 'user', 'overlay', 'orgSettings', 'settings', 'logins', 'storage', 'trash']);

export function isAdminPage(r: Route): boolean {
  return ADMIN_DIALOG_PAGES.has(r.page);
}

/** Inställningar's detail pages, which a page outside it may open straight (a song from a presentation's item). */
const DETAIL_PAGES = new Set<Route['page']>(['song', 'songHistory', 'user', 'overlay', 'org']);

/**
 * Whether `r` was opened straight from a page outside Inställningar (`adminBack` 1, see EntryState): then it stands
 * alone in the dialog, without the list or a way back, and Stäng is the way out.
 */
export function aloneInSettings(r: Route, back: number | undefined): boolean {
  return DETAIL_PAGES.has(r.page) && back === 1;
}

/** How many entries back the page under Inställningar is, if this entry knows. */
export function adminBack(): number | undefined {
  return (history.state as EntryState | null)?.adminBack;
}

export function href(r: Route): string {
  switch (r.page) {
    case 'presentations':
      return '/';
    case 'admin':
      return '/admin';
    case 'song':
      return `/admin/songs/${encodeURIComponent(r.id)}`;
    case 'songHistory':
      return `/admin/songs/${encodeURIComponent(r.id)}/history`;
    case 'presentation': {
      const q = new URLSearchParams();
      if (r.remote) q.set('remote', 'true');
      if (r.remote && r.session) q.set('session', r.session);
      return q.size ? `/presentations/${encodeURIComponent(r.id)}?${q}` : `/presentations/${encodeURIComponent(r.id)}`;
    }
    case 'overlay':
      return `/admin/overlays/${encodeURIComponent(r.id)}`;
    case 'user':
      return `/admin/users/${encodeURIComponent(r.id)}`;
    case 'template':
      return `/templates/${encodeURIComponent(r.id)}`;
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
    case 'orgSettings':
      return '/admin/settings';
    case 'ccliReport':
      return '/admin/ccli-report';
    case 'publicOutputs':
      return '/admin/public-outputs';
    case 'orgs':
      return '/admin/organizations';
    case 'org':
      return `/admin/organizations/${encodeURIComponent(r.id)}`;
    case 'logins':
      return r.error ? `/logins?error=${encodeURIComponent(r.error)}` : '/logins';
    default:
      return ADMIN_PAGES.has(r.page) ? `/admin/${r.page}` : `/${r.page}`;
  }
}

const NAVIGATED = 'gp:navigate';

/**
 * What an entry of the history knows: `adminBack`, on an admin page, is how many
 * entries back the page under the admin dialog is. None when the admin pages were
 * opened from the address bar: nothing of the app's is behind them.
 */
interface EntryState {
  adminBack?: number;
  /** A template's editor opened from Mallar, which is one entry back. */
  fromTemplates?: boolean;
}

/** A new entry for `url`, counting the admin pages opened since the page under them. */
function push(url: string) {
  const to = new URL(url, location.href);
  let state: EntryState | null = null;
  if (isAdminPage(parseRoute(to.pathname, to.search, to.hash))) {
    if (!isAdminPage(currentRoute())) state = { adminBack: 1 };
    else {
      const back = adminBack();
      if (back) state = { adminBack: back + 1 };
    }
  } else if (parseRoute(to.pathname).page === 'template' && currentRoute().page === 'templates') state = { fromTemplates: true };
  history.pushState(state, '', url);
  dispatchEvent(new Event(NAVIGATED));
}

export function navigate(r: Route) {
  push(href(r));
}

/**
 * Closes Inställningar: back through the admin pages to the page under them, as it
 * was. Opened from the address bar, nothing is behind them: `under` opens instead.
 */
export function closeAdmin(under: Route) {
  const back = adminBack();
  if (back) history.go(-back);
  else navigate(under);
}

/**
 * A template's ‹: back to Mallar, which it was opened from (Lars, 2026-11-02). Opened some other way (a link), Mallar
 * takes its entry.
 */
export function backToTemplates() {
  if ((history.state as EntryState | null)?.fromTemplates) history.back();
  else {
    history.replaceState(null, '', href({ page: 'templates' }));
    dispatchEvent(new Event(NAVIGATED));
  }
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
    push(url.pathname + url.search + url.hash);
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
