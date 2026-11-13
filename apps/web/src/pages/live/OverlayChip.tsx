import type { Overlay, PresentationItem } from '@gp/core';
import { t } from '../../i18n.ts';

/** The overlay an item carries, beside its heading, so it shows without opening the …. */
export function OverlayChip({ item, overlays }: { item: PresentationItem; overlays: Overlay[] }) {
  const overlay = item.overlayId ? overlays.find((o) => o.id === item.overlayId) : undefined;
  if (!overlay) return null;
  return (
    <span className="shrink-0 px-2 py-0.5 rounded-full text-[11px] normal-case tracking-normal font-medium bg-indigo-500/12 text-indigo-600 dark:text-indigo-300" title={t('overlays.itemOverlay')}>
      {overlay.title}
    </span>
  );
}
