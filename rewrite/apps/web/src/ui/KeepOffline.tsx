import { useEffect, useState } from 'react';
import type { Presentation } from '@gp/core';
import { addDays, presentationOfflineState } from '@gp/sync/client';
import { isPinned } from '../db/queries.ts';
import { useData, useDb, useDbStatus } from '../db/react.tsx';
import { isHostWindow } from '../hostWindow.ts';
import { t } from '../i18n.ts';
import { localToday } from '../pages/dashboard.ts';
import { AppButton } from './AppButton.tsx';
import { CheckCircleIcon } from './icons.tsx';

// Keeping a presentation offline (TODO.md "Video, and which files a device fetches"): a choice each
// device makes, by hand per presentation, or for the coming seven days under Mina inställningar. A
// presentation kept offline has every file here, its videos whole too, and its icon says so wherever
// the presentation shows: not kept, being fetched (how far), or all here.

const KEEP_COMING_KEY = 'gp.keepComing';
/** Fired when "Spara kommande presentationer offline" changes in this window. */
export const KEEP_COMING_CHANGED = 'gp:keep-coming';
/** How many days ahead "kommande" reaches: today and the seven after. */
const COMING_DAYS = 7;

/** "Spara kommande presentationer offline" on this device: off at first, as the theme is a choice of the device. */
export function keepComingSetting(): boolean {
  try {
    return localStorage.getItem(KEEP_COMING_KEY) === '1';
  } catch {
    return false;
  }
}

export function setKeepComingSetting(on: boolean) {
  try {
    localStorage.setItem(KEEP_COMING_KEY, on ? '1' : '0');
  } catch {
    // Storage refused (a private window): the choice lasts until the page closes.
  }
  dispatchEvent(new Event(KEEP_COMING_CHANGED));
}

/** The setting, kept current while the page shows it. */
export function useKeepComing(): boolean {
  const [on, setOn] = useState(keepComingSetting);
  useEffect(() => {
    const update = () => setOn(keepComingSetting());
    addEventListener(KEEP_COMING_CHANGED, update);
    return () => removeEventListener(KEEP_COMING_CHANGED, update);
  }, []);
  return on;
}

/** Whether a presentation is one of the coming days' that the setting keeps offline. */
export function keptByComing(p: Pick<Presentation, 'eventDate' | 'isTemplate' | 'deletedAt'>, on: boolean, today = localToday()): boolean {
  return on && !p.isTemplate && p.deletedAt === null && !!p.eventDate && p.eventDate >= today && p.eventDate <= addDays(today, COMING_DAYS);
}

type KeepState = 'none' | 'fetching' | 'kept';

/**
 * A presentation kept offline on this device, or not: chosen by hand, or by the setting for the coming
 * days. `share` is how much of it is here while it is fetched. Hidden on a desktop host's own window,
 * which keeps nothing (its server beside it has everything); `unavailable` where the device keeps
 * nothing between reloads.
 */
export function useKeepOffline(presentation: Pick<Presentation, 'id' | 'eventDate' | 'isTemplate' | 'deletedAt'>) {
  const db = useDb();
  const status = useDbStatus();
  const coming = useKeepComing();
  const saved = useData((r) => isPinned(r, presentation.id), [presentation.id]);
  const files = useData((r) => presentationOfflineState(r, presentation.id), [presentation.id]);
  // The click shows at once, until what the database says changes: then that is the truth.
  const [clicked, setClicked] = useState<{ value: boolean; over: boolean | undefined } | null>(null);
  const pinned = clicked && clicked.over === saved ? clicked.value : saved;
  const persistent = status?.storage === 'opfs';
  const bySetting = keptByComing(presentation, coming);
  const kept = persistent && (!!pinned || bySetting);
  const state: KeepState = !kept ? 'none' : files?.complete ? 'kept' : 'fetching';
  return {
    hidden: isHostWindow() || presentation.isTemplate,
    kept,
    state,
    share: files?.share ?? 0,
    /** Kept by the setting for the coming days: undone there, not here. */
    bySetting: persistent && bySetting,
    /** Known only once the database has answered; a device that keeps nothing cannot keep anything offline. */
    unavailable: !!status && !persistent,
    ready: persistent && pinned !== undefined,
    set(value: boolean) {
      setClicked({ value, over: saved });
      void db.setPinned(presentation.id, value);
    },
  };
}

/** Cloud with an arrow down (Heroicons' cloud-arrow-down): not kept here, a click keeps it. */
export function CloudArrowDownIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className} aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 9.75v6.75m0 0-3-3m3 3 3-3m-8.25 6a4.5 4.5 0 0 1-1.41-8.775 5.25 5.25 0 0 1 10.233-2.33 3 3 0 0 1 3.758 3.848A3.752 3.752 0 0 1 18 19.5H6.75Z"
      />
    </svg>
  );
}

/** A ring that fills as the files come, as Spotify's download button does. */
export function ProgressRing({ share, className }: { share: number; className?: string }) {
  const r = 9;
  const length = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r={r} fill="none" strokeWidth={2.5} className="stroke-neutral-300 dark:stroke-neutral-600" />
      <circle
        cx="12"
        cy="12"
        r={r}
        fill="none"
        strokeWidth={2.5}
        strokeLinecap="round"
        className="stroke-sky-500 transition-[stroke-dasharray] duration-300"
        strokeDasharray={`${Math.max(0.04, share) * length} ${length}`}
        transform="rotate(-90 12 12)"
      />
    </svg>
  );
}

/**
 * The icon of a presentation's offline state, a button that keeps it offline or stops: a cloud with an
 * arrow while it is not kept, a ring that fills while its files come, a sky check once all is here.
 * Kept by the setting for the coming days, it says so and is undone there.
 */
export function KeepOfflineButton({ presentation, className = '' }: { presentation: Pick<Presentation, 'id' | 'name' | 'eventDate' | 'isTemplate' | 'deletedAt'>; className?: string }) {
  const keep = useKeepOffline(presentation);
  if (keep.hidden) return null;
  const percent = Math.floor(keep.share * 100);
  const label = keep.unavailable
    ? t('offline.unavailable')
    : keep.state === 'none'
      ? t('offline.keep', { name: presentation.name })
      : keep.state === 'fetching'
        ? t('offline.fetching', { name: presentation.name, percent })
        : t(keep.bySetting ? 'offline.keptComing' : 'offline.kept', { name: presentation.name });
  const disabled = keep.unavailable || !keep.ready || (keep.bySetting && keep.state !== 'none');
  return (
    <AppButton
      variant="plain"
      aria-label={label}
      title={label}
      aria-pressed={keep.kept}
      disabled={disabled}
      data-testid="keep-offline"
      data-state={keep.unavailable ? 'unavailable' : keep.state}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        keep.set(!keep.kept);
      }}
      className={`size-8 justify-center rounded-full shrink-0 flex items-center transition ${disabled ? 'cursor-default' : 'cursor-pointer hover:bg-raised'} ${
        keep.unavailable ? 'opacity-40' : ''
      } ${className}`}
    >
      {keep.state === 'kept' ? (
        <CheckCircleIcon className="size-5 text-sky-500" />
      ) : keep.state === 'fetching' ? (
        <ProgressRing share={keep.share} className="size-5" />
      ) : (
        <CloudArrowDownIcon className="size-5 shrink-0 text-neutral-400 dark:text-neutral-500" />
      )}
    </AppButton>
  );
}
