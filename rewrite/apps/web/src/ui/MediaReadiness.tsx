import { useState } from 'react';
import { useData, useDb, useDbStatus, usePresentationMedia } from '../db/react.tsx';
import { isPinned } from '../db/queries.ts';
import { t } from '../i18n.ts';
import { AppButton } from './AppButton.tsx';
import { MENU_ITEM } from './Dropdown.tsx';
import { CheckIcon } from './icons.tsx';

/**
 * Whether the pictures and audio a presentation needs are on this device
 * (docs/media-and-files.md, "Which files a device keeps"). While it is open they are fetched;
 * offline, what is missing cannot be, and that is said before going live.
 */
export function MediaReadiness({ presentationId, audio }: { presentationId: string; audio: boolean }) {
  const state = usePresentationMedia(presentationId, audio);
  const status = useDbStatus();
  if (!state || state.needed === 0) return null;
  const missing = state.needed - state.present;
  // All there is the usual case: said to screen readers only, so the eye meets a line only when something is missing.
  if (!missing) {
    return (
      <p className="sr-only" data-testid="media-ready">
        {t('media.ready')}
      </p>
    );
  }
  return (
    <p className={`text-xs ${status?.connected === false ? 'text-amber-600 dark:text-amber-400' : 'text-neutral-500 dark:text-neutral-400'}`} data-testid="media-ready">
      {status?.connected === false ? t('media.missingOffline', { n: missing }) : t('media.fetching', { present: state.present, needed: state.needed })}
    </p>
  );
}

/**
 * "Tillgänglig offline": keep every file of this presentation on this device,
 * whatever its date, so it can be worked with or presented without a
 * connection. Only where the data survives a reload; elsewhere it says why.
 */
export function useKeepOffline(presentationId: string) {
  const db = useDb();
  const status = useDbStatus();
  const saved = useData((r) => isPinned(r, presentationId), [presentationId]);
  // The click shows at once, until what the database says changes: then that is the truth.
  const [clicked, setClicked] = useState<{ value: boolean; over: boolean | undefined } | null>(null);
  const pinned = clicked && clicked.over === saved ? clicked.value : saved;
  const persistent = status?.storage === 'opfs';
  return {
    kept: !!pinned && persistent,
    /** Known only once the database has answered; an unknown device cannot keep anything. */
    unavailable: !!status && !persistent,
    ready: persistent && pinned !== undefined,
    set(value: boolean) {
      setClicked({ value, over: saved });
      void db.setPinned(presentationId, value);
    },
  };
}

/** The choice as an item of the presentation's ⋯ menu, ticked when kept. */
export function KeepOfflineItem({ keep }: { keep: ReturnType<typeof useKeepOffline> }) {
  return (
    <>
      <AppButton
        variant="plain"
        role="menuitemcheckbox"
        aria-checked={keep.kept}
        disabled={!keep.ready}
        className={`${MENU_ITEM} whitespace-normal! disabled:opacity-50 disabled:cursor-default`}
        onClick={() => keep.set(!keep.kept)}
      >
        <CheckIcon className={`size-4 ${keep.kept ? '' : 'invisible'}`} />
        {t('media.keepOffline')}
      </AppButton>
      {keep.unavailable && <p className="px-4 pb-2 text-xs text-neutral-400 dark:text-neutral-500">{t('media.keepOfflineUnavailable')}</p>}
    </>
  );
}

/** The grey pill by the title of a presentation kept offline, as on Presentationer. */
export function OfflinePill() {
  return (
    <span className="shrink-0 inline-flex items-center rounded-full bg-neutral-200 dark:bg-neutral-700 px-2 py-0.5 text-xs text-neutral-600 dark:text-neutral-300">{t('media.offlineBadge')}</span>
  );
}
