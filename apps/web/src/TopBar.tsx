import { useEffect, useState, type ReactNode } from 'react';
import type { Me } from '@gp/core';
import { api } from './auth/api.ts';
import { switchOrg } from './auth/orgs.ts';
import { useDb, useDbStatus } from './db/react.tsx';
import { t } from './i18n.ts';
import { signOut, SyncWarnings } from './Shell.tsx';
import { AppButton } from './ui/AppButton.tsx';
import { FloatingSearchButton, SearchButton } from './ui/CommandPalette.tsx';
import { useWide } from './ui/useWide.ts';
import { Dropdown } from './ui/Dropdown.tsx';
import { ArrowsRightLeftIcon, BugIcon, CheckIcon, ChevronLeftIcon, CloudOffIcon, CogIcon, LogoIcon, SignOutIcon } from './ui/icons.tsx';
import { href } from './ui/router.ts';
import { runCommand } from './ui/appKeys.ts';
import { useUnreadReplies } from './report/unread.ts';
import { initials, syncState, useWaitedLong } from './ui/syncState.ts';
import { useToast } from './ui/Toast.tsx';
import { LIFTED, ROUND_BACK } from './ui/glass.ts';

// The bar at the top of the start page and the pages outside a presentation (docs/layout-2-0.md, "The start page and
// the bar"): + and the user's picture, whose menu holds the rest. The cloud shows only when the sync has a problem.

/** How the sync stands (ui/syncState.ts), with changes waiting or no connection past the grace counted as a problem. */
function useSync() {
  const s = useDbStatus();
  const waitedLong = useWaitedLong(!!s && (s.pending > 0 || !s.connected));
  return s ? syncState(s, waitedLong) : null;
}

/**
 * The sync in the bar: the orange cloud while something is wrong, which syncs now; otherwise only words for screen
 * readers. The words are what the tests read.
 */
function SyncStatus({ sync }: { sync: { problem: boolean; text: string } | null }) {
  const db = useDb();
  if (!sync) return null;
  if (!sync.problem)
    return (
      <span data-testid="status" className="sr-only">
        {sync.text}
      </span>
    );
  return (
    <AppButton
      variant="plain"
      data-testid="status"
      aria-label={`${sync.text} · ${t('status.syncNow')}`}
      title={`${sync.text} · ${t('status.syncNow')}`}
      // As tall as the round buttons beside it; on a phone, where its words are hidden, as round as they are.
      className="flex items-center justify-center gap-1.5 h-9 touch:h-11 px-3 max-sm:px-0 max-sm:w-9 max-sm:touch:w-11 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 text-xs font-semibold cursor-pointer"
      onClick={() => void db.syncNow()}
    >
      <CloudOffIcon className="size-4 shrink-0" />
      <span className="max-sm:sr-only truncate max-w-48">{sync.text}</span>
    </AppButton>
  );
}

/**
 * The sync's line at the foot of a presentation's column (on a phone, of its list), only while something waits or is
 * wrong, in amber, in the place of whether it is kept offline (`fallback`, OfflineStatus); silent while all is well, as
 * Notes is (Lars, 2026-11-02). Merely offline with nothing waiting, the fallback stays: then "Sparad offline" is what
 * matters, and the bar's cloud says offline. A click syncs now.
 */
export function SyncLine({ className = 'w-full', fallback = null }: { className?: string; fallback?: ReactNode }) {
  const db = useDb();
  const sync = useSync();
  if (!sync?.problem || (fallback && sync.text === t('status.offline'))) return fallback;
  return (
    <AppButton
      variant="plain"
      data-testid="sync-line"
      title={t('status.syncNow')}
      onClick={() => void db.syncNow()}
      className={`${className} flex items-center gap-2 px-2 py-1.5 touch:py-2.5 rounded-lg text-xs touch:text-[13px] text-left hover:bg-raised cursor-pointer text-amber-600 dark:text-amber-400`}
    >
      <CloudOffIcon className="size-4 shrink-0" />
      <span className="truncate">{sync.text}</span>
    </AppButton>
  );
}

/** The sync's cloud alone, for a bar without the picture (a presentation's on a computer): only while something is wrong. */
export function SyncCloud() {
  return <SyncStatus sync={useSync()} />;
}

/** The user's picture: their initials in a coloured circle, until there are pictures (docs/not-done-yet.md). */
export function Avatar({ name, className }: { name: string; className: string }) {
  return (
    <span aria-hidden="true" className={`shrink-0 rounded-full bg-indigo-500 text-white font-semibold flex items-center justify-center select-none ${className}`}>
      {initials(name)}
    </span>
  );
}

type SwitchOrg = { id: string; name: string };

/** The organisations the user may switch to, or none offline; Byt organisation shows only when there is a choice. */
function useSwitchOrgs(): SwitchOrg[] {
  const [orgs, setOrgs] = useState<SwitchOrg[]>([]);
  useEffect(() => {
    api<SwitchOrg[]>('GET', '/api/auth/orgs').then(
      (r) => !r.error && setOrgs(r.body),
      () => undefined, // offline: no switching
    );
  }, []);
  // Only with somewhere to switch to, a super admin too (Lars, 2026-11-02).
  return orgs.length > 1 ? orgs : [];
}

// On a computer a row's highlight is inset with round corners, as macOS's and GitHub's menus (Lars, 2026-11-02).
const ROW = 'flex items-center gap-3 w-full sm:w-[calc(100%-0.75rem)] sm:mx-1.5 sm:rounded-md min-h-11 sm:min-h-8 px-4 sm:px-2.5 py-2 sm:py-1.5 text-left text-[15px] text-stone-800 dark:text-stone-100 hover:bg-raised-2 focus:bg-raised-2 focus:outline-none cursor-pointer no-underline';
const DIVIDER = 'h-2 sm:h-px sm:mx-3 sm:my-1 bg-black/5 dark:bg-black/25 sm:bg-separator sm:dark:bg-separator';

const ICON = 'size-[18px] sm:size-4 shrink-0 text-stone-500 dark:text-stone-400';

/** Byt organisation, which unfolds the organisations in the menu, the active one checked. Choosing one loads the start page there (ORG-R7). */
function OrgChoices({ me, orgs }: { me: Me; orgs: SwitchOrg[] }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  return (
    <>
      <AppButton
        variant="plain"
        role="menuitem"
        aria-expanded={open}
        className={ROW}
        onClick={(e) => {
          e.stopPropagation(); // unfolds, rather than closing the menu
          setOpen((o) => !o);
        }}
      >
        <ArrowsRightLeftIcon className={ICON} />
        <span className="flex-1">{t('profile.switchOrg')}</span>
        {/* Which one is active shows as a check when the list unfolds. */}
        <span className="text-stone-500 dark:text-stone-400">›</span>
      </AppButton>
      {open &&
        orgs.map((o) => (
          <AppButton
            key={o.id}
            variant="plain"
            role="menuitem"
            className={`${ROW} pl-11 sm:pl-9 ${o.id === me.orgId ? 'text-sky-600! dark:text-sky-400!' : ''}`}
            onClick={() => {
              if (o.id !== me.orgId) void switchOrg(o.id).then((error) => error && toast(error, 'warning'));
            }}
          >
            <span className="flex-1 truncate">{o.name}</span>
            {o.id === me.orgId && <CheckIcon className="size-4 shrink-0" />}
          </AppButton>
        ))}
    </>
  );
}

/**
 * The picture's menu (docs/layout-2-0.md): the name, Inställningar (Mina inställningar is a row in it), Byt
 * organisation with two or more, what is wrong with the sync and Synka nu (nothing while all is synced), and Logga ut
 * (Lars, 2026-11-02). A dot on the picture while the sync has a problem.
 */
function ProfileMenu({ me, sync }: { me: Me; sync: { problem: boolean; text: string } | null }) {
  const db = useDb();
  const orgs = useSwitchOrgs();
  const unread = useUnreadReplies();
  const who = `${me.name} · ${me.orgName}`;
  return (
    <Dropdown
      menuClassName="w-72 sm:w-64 rounded-[26px]! sm:rounded-xl! bg-surface! sm:bg-raised! py-0 sm:py-1"
      button={{ className: 'relative block cursor-pointer rounded-full', 'data-testid': 'me', 'aria-label': who, title: who }}
      trigger={
        <>
          <Avatar name={me.name} className="size-11 sm:size-8 text-base sm:text-xs" />
          {/* Amber while the sync has a problem; else blue while an answer to a bug report waits unread. */}
          {(sync?.problem || unread > 0) && <span className={`absolute top-0 right-0 size-3 sm:size-2.5 rounded-full ring-2 ring-surface ${sync?.problem ? 'bg-amber-500' : 'bg-sky-500'}`} />}
        </>
      }
    >
      <div className="flex items-center gap-3 px-4 py-3 sm:py-2">
        <Avatar name={me.name} className="size-10 sm:size-8 text-sm sm:text-xs" />
        {/* The name alone: no role, no organisation (Lars, 2026-11-02). */}
        <div className="min-w-0 text-[17px] sm:text-sm font-semibold truncate">{me.name}</div>
      </div>
      {/* Inställningar is the bar's cog, so not here too (Lars, 2026-11-04: one way there). */}
      {orgs.length > 0 && (
        <>
          <div className={DIVIDER} />
          <OrgChoices me={me} orgs={orgs} />
        </>
      )}
      {sync?.problem && (
        <>
          <div className={DIVIDER} />
          <div data-testid="sync-state" className="flex items-center justify-between gap-3 min-h-11 sm:min-h-8 px-4 text-[15px] sm:text-[13px] text-amber-600 dark:text-amber-400">
            <span className="flex items-center gap-2 min-w-0">
              <span className="size-2 shrink-0 rounded-full bg-amber-500" />
              <span className="truncate">{sync.text}</span>
            </span>
            <AppButton variant="plain" role="menuitem" className="shrink-0 h-7 sm:h-6 px-3 rounded-full bg-black/5 dark:bg-white/10 text-sky-600 dark:text-sky-400 text-xs font-semibold cursor-pointer" onClick={() => void db.syncNow()}>
              {t('status.syncNow')}
            </AppButton>
          </div>
        </>
      )}
      <div className={DIVIDER} />
      {/* For everyone, on every page with this bar (docs/bug-reports.md); the desktop app also has it under Hjälp. */}
      {unread > 0 && (
        <AppButton variant="plain" role="menuitem" className={`${ROW} text-sky-600! dark:text-sky-400!`} href={href({ page: 'myReports' })}>
          <span className="size-2 mx-[5px] sm:mx-1 shrink-0 rounded-full bg-sky-500" />
          {t('myReports.answers', { n: unread })}
        </AppButton>
      )}
      <AppButton variant="plain" role="menuitem" className={ROW} onClick={() => runCommand('report')}>
        <BugIcon className="size-[18px] sm:size-4 shrink-0" />
        {t('report.title')}
      </AppButton>
      <AppButton variant="plain" role="menuitem" className={`${ROW} text-red-600! dark:text-red-400!`} onClick={() => void signOut()}>
        <SignOutIcon className="size-[18px] sm:size-4 shrink-0" />
        {t('auth.signOut')}
      </AppButton>
    </Dropdown>
  );
}

/** The bar's right end: the cloud while the sync has a problem, and the picture's menu. */
function BarEnd({ me }: { me: Me }) {
  const sync = useSync();
  const wide = useWide();
  return (
    <div className="flex items-center gap-3">
      <SyncStatus sync={sync} />
      {/* Beside the cog where there is room; on a phone it floats at the bottom left. */}
      {wide ? <SearchButton className={`size-9 touch:size-11 rounded-full flex items-center justify-center text-stone-700 dark:text-stone-200 cursor-pointer ${LIFTED}`} iconClassName="size-4" /> : <FloatingSearchButton />}
      {/* Inställningar a click away on every page, as the presentation's bar has it (Lars, 2026-11-02). */}
      <a href={href({ page: 'admin' })} aria-label={t('nav.admin')} title={t('nav.admin')} className={`size-9 touch:size-11 rounded-full flex items-center justify-center text-stone-700 dark:text-stone-200 no-underline ${LIFTED}`}>
        <CogIcon className="size-4" />
      </a>
      <ProfileMenu me={me} sync={sync} />
    </div>
  );
}


/** The bar's way back to the start page, a round ‹ alone as iOS 27's and the live bar's. */
export function BackToPresentations() {
  return (
    <a
      href={href({ page: 'presentations' })}
      title={t('nav.backToPresentations')}
      aria-label={t('nav.backToPresentations')}
      className={ROUND_BACK}
    >
      <ChevronLeftIcon className="size-5" />
    </a>
  );
}

/**
 * The bar at the top: the logo, on a phone too (Lars, 2026-11-02); at the right the picture (the start page's + is in
 * its heading row). A presentation has a bar of its own. The warnings under it, unless Inställningar covers it and
 * shows them itself.
 */
export function TopBar({ me, warnings }: { me: Me; warnings: boolean }) {
  return (
    <>
      <nav data-window-bar className="relative flex items-center justify-between gap-3 px-4 h-14 sm:h-13 shrink-0 sm:border-b-[0.5px] sm:border-separator bg-ground">
        <div className="flex items-center gap-3">
          <a href={href({ page: 'presentations' })} className="flex items-center gap-2 text-sky-500 hover:text-sky-600 no-underline">
            <LogoIcon className="size-6" />
            <span className="text-sm font-semibold uppercase tracking-wide whitespace-nowrap">
              <span className="text-sky-500">Gospel</span> <span className="text-sky-400">Presenter</span>
            </span>
          </a>
          <span className="inline-flex items-center rounded-full bg-orange-500 px-2.5 shrink-0 py-0.5 text-xs font-semibold text-white">{t('app.beta')}</span>
        </div>
        <span className="flex-1" />
        <BarEnd me={me} />
      </nav>
      {warnings && <SyncWarnings />}
    </>
  );
}
