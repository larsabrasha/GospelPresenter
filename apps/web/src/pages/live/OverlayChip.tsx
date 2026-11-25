import type { Overlay, PresentationItem } from '@gp/core';
import { t } from '../../i18n.ts';
import { SquaresOverlapIcon } from '../../ui/icons.tsx';

/** An overlay's colours, its chip's under the running order's row and its larger one under the item's heading. */
const OVERLAY_TINT = 'bg-indigo-500/12 text-indigo-600 dark:text-indigo-300';
/** The overlay chip under the running order's row (Lars, 2026-11-25). */
export const OVERLAY_CHIP = `inline-flex items-center gap-1 min-w-0 max-w-full px-2 py-0.5 rounded-full text-[11px]/4 normal-case tracking-normal font-medium ${OVERLAY_TINT}`;
/**
 * An item's comment under its row: its icon and its words in grey, with no pill around them (Lars, 2026-11-25: the
 * rounded grey behind each made the list busy).
 */
export const NOTE_CHIP = 'inline-flex items-center gap-1 min-w-0 max-w-full text-xs/4 text-stone-500 dark:text-stone-400';

/** The overlay an item carries, on a line of its own under its heading, so it shows without opening the …. */
export function OverlayChip({ item, overlays }: { item: PresentationItem; overlays: Overlay[] }) {
  const overlay = item.overlayId ? overlays.find((o) => o.id === item.overlayId) : undefined;
  if (!overlay) return null;
  return (
    // As large as the comment under it, its padding and its text the same (Lars, 2026-11-25).
    <span className={`self-start inline-flex items-center gap-1.5 min-w-0 max-w-full px-3 py-1.5 rounded-full text-[13px]/[18px] font-medium ${OVERLAY_TINT}`} title={t('overlays.itemOverlay')} data-testid="item-overlay">
      <SquaresOverlapIcon className="size-3.5 shrink-0" />
      {/* Said in words here, beside the heading, for one who has not met overlays (Lars, 2026-11-25); the running
          order's chip has the name alone. */}
      <span className="truncate">{t('overlays.chip', { title: overlay.title })}</span>
    </span>
  );
}
