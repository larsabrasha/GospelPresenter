import { useEffect, useState } from 'react';
import type { Me } from '@gp/core';
import { api } from './auth/api.ts';
import { switchOrg } from './auth/orgs.ts';
import { useDb, useDbStatus } from './db/react.tsx';
import { t } from './i18n.ts';
import { signOut, SyncWarnings } from './Shell.tsx';
import { AppButton } from './ui/AppButton.tsx';
import { Dropdown } from './ui/Dropdown.tsx';
import { CheckIcon, ChevronLeftIcon, CloudOffIcon, LogoIcon } from './ui/icons.tsx';
import { href } from './ui/router.ts';
import { initials, PENDING_GRACE_MS, syncState } from './ui/syncState.ts';
import { useToast } from './ui/Toast.tsx';

// The bar at the top of the start page and the pages outside a presentation (docs/layout-2-0.md, "The start page and
// the bar"): + and the user's picture, whose menu holds the rest. The cloud shows only when the sync has a problem.

/** How many refused changes this page has told of; the worker's list only grows, and outlives a remount of the bar. */
let rejectionsToasted = 0;

/** How the sync stands (ui/syncState.ts), with changes that have waited past the grace counted as a problem. */
function useSync() {
  const s = useDbStatus();
  const toast = useToast();
  const pending = (s?.pending ?? 0) > 0;
  const [pendingLong, setPendingLong] = useState(false);
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => setPendingLong(true), PENDING_GRACE_MS);
    return () => {
      clearTimeout(timer);
      setPendingLong(false);
    };
  }, [pending]);
  // A change the server refused is told in a toast.
  const rejected = s?.rejected.length ?? 0;
  useEffect(() => {
    if (rejected <= rejectionsToasted) return;
    rejectionsToasted = rejected;
    toast(t('status.rejected'), 'warning');
  }, [rejected, toast]);
  return s ? syncState(s, pendingLong) : null;
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
      className="flex items-center gap-1.5 h-8 px-3 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 text-xs font-semibold cursor-pointer"
      onClick={() => void db.syncNow()}
    >
      <CloudOffIcon className="size-4 shrink-0" />
      <span className="max-sm:sr-only truncate max-w-48">{sync.text}</span>
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
function useSwitchOrgs(me: Me): SwitchOrg[] {
  const [orgs, setOrgs] = useState<SwitchOrg[]>([]);
  useEffect(() => {
    api<SwitchOrg[]>('GET', '/api/auth/orgs').then(
      (r) => !r.error && setOrgs(r.body),
      () => undefined, // offline: no switching
    );
  }, []);
  return me.role === 'superAdmin' || orgs.length > 1 ? orgs : [];
}

const ROW = 'flex items-center gap-3 w-full min-h-11 px-4 py-2 text-left text-[15px] text-neutral-800 dark:text-neutral-100 hover:bg-raised-2 focus:bg-raised-2 focus:outline-none cursor-pointer no-underline';
const DIVIDER = 'h-2 sm:h-px sm:mx-3 sm:my-1 bg-black/5 dark:bg-black/25 sm:bg-separator sm:dark:bg-separator';

/** A choice in the menu with a grey line under it, named by its first line alone. */
function Choice({ to, label, sub }: { to: string; label: string; sub: string }) {
  return (
    <a href={to} role="menuitem" aria-label={label} className={ROW}>
      <span className="flex flex-col">
        <span>{label}</span>
        <span className="text-xs text-neutral-500 dark:text-neutral-400">{sub}</span>
      </span>
    </a>
  );
}

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
        <span className="flex-1">{t('profile.switchOrg')}</span>
        <span className="text-neutral-500 dark:text-neutral-400 truncate max-w-28">{me.orgName} ›</span>
      </AppButton>
      {open &&
        orgs.map((o) => (
          <AppButton
            key={o.id}
            variant="plain"
            role="menuitem"
            className={`${ROW} pl-8 ${o.id === me.orgId ? 'text-sky-600! dark:text-sky-400!' : ''}`}
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
 * The picture's menu (docs/layout-2-0.md): who, Mina inställningar, Inställningar, Byt organisation, how the sync
 * stands with Synka nu when something is wrong, and Logga ut. A dot on the picture while the sync has a problem.
 */
function ProfileMenu({ me, sync }: { me: Me; sync: { problem: boolean; text: string } | null }) {
  const db = useDb();
  const orgs = useSwitchOrgs(me);
  const who = `${me.name} · ${me.orgName}`;
  return (
    <Dropdown
      menuClassName="w-72 sm:w-64 rounded-[26px]! sm:rounded-xl! bg-surface! sm:bg-raised! py-0 sm:py-1"
      button={{ className: 'relative block cursor-pointer rounded-full', 'data-testid': 'me', 'aria-label': who, title: who }}
      trigger={
        <>
          <Avatar name={me.name} className="size-11 sm:size-8 text-base sm:text-xs" />
          {sync?.problem && <span className="absolute top-0 right-0 size-3 sm:size-2.5 rounded-full bg-amber-500 ring-2 ring-surface" />}
        </>
      }
    >
      <div className="flex items-center gap-3 px-4 py-3 sm:py-2">
        <Avatar name={me.name} className="size-10 sm:size-8 text-sm sm:text-xs" />
        <div className="min-w-0">
          <div className="text-[17px] sm:text-sm font-semibold truncate">{me.name}</div>
          <div className="text-xs text-neutral-500 dark:text-neutral-400 truncate">
            {t(me.role === 'superAdmin' ? 'role.superAdmin' : me.role === 'admin' ? 'role.admin' : 'role.user')} · {me.orgName}
          </div>
        </div>
      </div>
      <div className={DIVIDER} />
      <Choice to={href({ page: 'settings' })} label={t('nav.settings')} sub={t('profile.mineText')} />
      <Choice to={href({ page: 'admin' })} label={t('nav.admin')} sub={t('profile.settingsText')} />
      {orgs.length > 0 && <OrgChoices me={me} orgs={orgs} />}
      <div className={DIVIDER} />
      {sync && (
        <div data-testid="sync-state" className={`flex items-center justify-between gap-3 min-h-11 sm:min-h-8 px-4 text-[15px] sm:text-[13px] ${sync.problem ? 'text-amber-600 dark:text-amber-400' : 'text-green-600 dark:text-green-500'}`}>
          <span className="flex items-center gap-2 min-w-0">
            <span className={`size-2 shrink-0 rounded-full ${sync.problem ? 'bg-amber-500' : 'bg-green-500'}`} />
            <span className="truncate">{sync.text}</span>
          </span>
          {sync.problem && (
            <AppButton variant="plain" role="menuitem" className="shrink-0 h-7 sm:h-6 px-3 rounded-full bg-black/5 dark:bg-white/10 text-sky-600 dark:text-sky-400 text-xs font-semibold cursor-pointer" onClick={() => void db.syncNow()}>
              {t('status.syncNow')}
            </AppButton>
          )}
        </div>
      )}
      <div className={DIVIDER} />
      <AppButton variant="plain" role="menuitem" className={`${ROW} text-red-600! dark:text-red-400!`} onClick={() => void signOut()}>
        {t('auth.signOut')}
      </AppButton>
    </Dropdown>
  );
}

/** The bar's right end: the cloud while the sync has a problem, and the picture's menu. */
function BarEnd({ me }: { me: Me }) {
  const sync = useSync();
  return (
    <div className="flex items-center gap-2.5">
      <SyncStatus sync={sync} />
      <ProfileMenu me={me} sync={sync} />
    </div>
  );
}

/** The bar's way back to the start page, as the live bar's "‹ Presentationer". */
export function BackToPresentations() {
  return (
    <a
      href={href({ page: 'presentations' })}
      title={t('nav.backToPresentations')}
      aria-label={t('nav.backToPresentations')}
      className="flex items-center gap-1 -ml-1 text-sm font-medium text-sky-500 hover:text-sky-600 no-underline whitespace-nowrap"
    >
      <ChevronLeftIcon className="size-5" />
      {t('nav.presentations')}
    </a>
  );
}

/**
 * The bar at the top: the logo (from the `sm` width; a phone shows the page's large title alone); at the right the
 * picture (the start page's + is in its heading row). A presentation has a bar of its own. The warnings under it,
 * unless Inställningar covers it and shows them itself.
 */
export function TopBar({ me, warnings }: { me: Me; warnings: boolean }) {
  return (
    <>
      <nav className="relative flex items-center justify-between gap-3 px-4 h-14 sm:h-12 shrink-0 sm:border-b-[0.5px] sm:border-separator sm:bg-surface">
        <div className="max-sm:hidden flex items-center gap-3">
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
