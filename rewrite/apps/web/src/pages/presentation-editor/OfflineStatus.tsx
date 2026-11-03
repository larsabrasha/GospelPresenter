import type { Presentation } from '@gp/core';
import { t } from '../../i18n.ts';
import { AppButton } from '../../ui/AppButton.tsx';
import { CheckCircleIcon } from '../../ui/icons.tsx';
import { CloudArrowDownIcon, ProgressRing, useKeepOffline } from '../../ui/KeepOffline.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { ToggleRow } from '../../ui/Toggle.tsx';
import { PanelGroup } from '../live/PanelGroup.tsx';

type Kept = Pick<Presentation, 'id' | 'name' | 'eventDate' | 'isTemplate' | 'deletedAt'>;

/** Not kept, being fetched (a ring that fills) or all here: the line's icon and the switch's. */
function StateIcon({ state, share }: { state: 'none' | 'fetching' | 'kept'; share: number }) {
  if (state === 'kept') return <CheckCircleIcon className="size-4 shrink-0 text-sky-500" />;
  if (state === 'fetching') return <ProgressRing share={share} className="size-4 shrink-0" />;
  return <CloudArrowDownIcon className="size-4 shrink-0 text-stone-500 dark:text-stone-400" />;
}

/**
 * A quiet line at the foot of a presentation's left column (on a phone, at the foot of the view), as Mail's
 * "Uppdaterad nyss": "Inte sparad offline", a ring that fills while its files come, then "Sparad offline". A click
 * opens the sheet that explains and changes it; it is the one place to keep a presentation offline by hand (Lars,
 * 2026-11-02).
 */
export function OfflineStatus({ presentation, onOpen, className = 'w-full' }: { presentation: Kept; onOpen: () => void; className?: string }) {
  const keep = useKeepOffline(presentation);
  if (keep.hidden) return null;
  return (
    <AppButton
      variant="plain"
      onClick={onOpen}
      data-testid="offline-status"
      data-state={keep.state}
      className={`${className} flex items-center gap-2 px-2 py-1.5 touch:py-2.5 rounded-lg text-xs touch:text-[13px] text-left text-stone-500 dark:text-stone-400 hover:bg-raised cursor-pointer`}
    >
      <StateIcon state={keep.state} share={keep.share} />
      {keep.state === 'kept' ? t('offline.keptStatus') : keep.state === 'fetching' ? t('offline.fetchingShort', { percent: Math.floor(keep.share * 100) }) : t('offline.notKept')}
    </AppButton>
  );
}

/**
 * Spara offline, from the line at the column's foot, as a sheet from the bottom with one group as Visning's and
 * Fjärrstyrning's (Lars, 2026-11-03: a calmer look, few words): the switch for this presentation, its icon as the
 * line's, and under its name what keeping does or how far it has come. The coming days are kept under Lagring.
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
          : t('offline.dialogText');
  return (
    <Sheet title={t('offline.keepShort')} onClose={onClose}>
      <PanelGroup sheet>
        <ToggleRow cell label={t('offline.switch')} checked={keep.kept} disabled={disabled} icon={<StateIcon state={keep.state} share={keep.share} />} sub={line} onChange={keep.set} />
      </PanelGroup>
    </Sheet>
  );
}
