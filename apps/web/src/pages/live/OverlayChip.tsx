import type { Overlay, PresentationItem } from '@gp/core';
import { t } from '../../i18n.ts';
import { SquaresOverlapIcon } from '../../ui/icons.tsx';

/** The overlay chip's look, the same beside the heading and under the running order's row (Lars, 2026-11-25). */
export const OVERLAY_CHIP = 'inline-flex items-center gap-1 min-w-0 max-w-full px-2 py-0.5 rounded-full text-[11px]/4 normal-case tracking-normal font-medium bg-indigo-500/12 text-indigo-600 dark:text-indigo-300';

/** The overlay an item carries, beside its heading, so it shows without opening the …. */
export function OverlayChip({ item, overlays }: { item: PresentationItem; overlays: Overlay[] }) {
  const overlay = item.overlayId ? overlays.find((o) => o.id === item.overlayId) : undefined;
  if (!overlay) return null;
  return (
    <span className={`shrink-0 ${OVERLAY_CHIP}`} title={t('overlays.itemOverlay')}>
      <SquaresOverlapIcon className="size-3 shrink-0" />
      <span className="truncate">{overlay.title}</span>
    </span>
  );
}
