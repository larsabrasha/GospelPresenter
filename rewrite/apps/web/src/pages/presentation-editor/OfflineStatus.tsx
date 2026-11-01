import type { Presentation } from '@gp/core';
import { t } from '../../i18n.ts';
import { AppButton } from '../../ui/AppButton.tsx';
import { Dialog, DialogButtons } from '../../ui/Dialog.tsx';
import { CheckCircleIcon } from '../../ui/icons.tsx';
import { ProgressRing, useKeepOffline } from '../../ui/KeepOffline.tsx';
import { href } from '../../ui/router.ts';
import { IOS_SWITCH } from '../../ui/Toggle.tsx';

type Kept = Pick<Presentation, 'id' | 'name' | 'eventDate' | 'isTemplate' | 'deletedAt'>;

/**
 * A quiet line at the foot of a presentation's left column while it is kept offline, as Mail's "Uppdaterad nyss":
 * a ring that fills while its files come, then "Sparad offline". A click opens the dialog that explains and changes
 * it (Lars, 2026-11-01).
 */
export function OfflineStatus({ presentation, onOpen }: { presentation: Kept; onOpen: () => void }) {
  const keep = useKeepOffline(presentation);
  if (keep.hidden || keep.state === 'none') return null;
  return (
    <AppButton
      variant="plain"
      onClick={onOpen}
      data-testid="offline-status"
      data-state={keep.state}
      className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-left text-neutral-500 dark:text-neutral-400 hover:bg-raised cursor-pointer"
    >
      {keep.state === 'kept' ? <CheckCircleIcon className="size-4 shrink-0 text-sky-500" /> : <ProgressRing share={keep.share} className="size-4 shrink-0" />}
      {keep.state === 'kept' ? t('offline.keptStatus') : t('offline.fetchingShort', { percent: Math.floor(keep.share * 100) })}
    </AppButton>
  );
}

/**
 * Spara offline, from the presentation's menu or the line at the column's foot: what keeping does, a switch for this
 * presentation, how far it has come, and where the coming days are kept on their own.
 */
export function OfflineDialog({ presentation, onClose }: { presentation: Kept; onClose: () => void }) {
  const keep = useKeepOffline(presentation);
  const disabled = keep.unavailable || !keep.ready || (keep.bySetting && keep.state !== 'none');
  const line = keep.unavailable
    ? t('offline.unavailable')
    : keep.bySetting && keep.state !== 'none'
      ? t('offline.byComing')
      : keep.state === 'fetching'
        ? t('offline.fetchingShort', { percent: Math.floor(keep.share * 100) })
        : keep.state === 'kept'
          ? t('offline.keptAll')
          : null;
  return (
    <Dialog title={t('offline.keepShort')} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-neutral-600 dark:text-neutral-300">{t('offline.dialogText', { name: presentation.name })}</p>
        <label className={`flex items-center gap-3 px-4 py-3 rounded-xl bg-raised ${disabled ? 'cursor-default' : 'cursor-pointer'}`}>
          <span className="flex-1 min-w-0 flex flex-col">
            <span className="text-[15px]">{t('offline.switch')}</span>
            {/* Always two lines high, so the row keeps its size as the state changes. */}
            <span className="text-xs text-neutral-500 dark:text-neutral-400 line-clamp-2 min-h-[2lh]">{line}</span>
          </span>
          <input
            type="checkbox"
            className={IOS_SWITCH}
            aria-label={t('offline.switch')}
            checked={keep.kept}
            disabled={disabled}
            data-testid="keep-offline"
            data-state={keep.unavailable ? 'unavailable' : keep.state}
            onChange={(e) => keep.set(e.target.checked)}
          />
        </label>
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          {t('offline.comingNote')}{' '}
          <a href={href({ page: 'settings' })} className="text-sky-500 hover:text-sky-600 no-underline">
            {t('nav.settings')}
          </a>
        </p>
        <DialogButtons>
          <AppButton onClick={onClose}>{t('common.close')}</AppButton>
        </DialogButtons>
      </div>
    </Dialog>
  );
}
