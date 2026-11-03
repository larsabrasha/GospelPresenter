import { t } from '../i18n.ts';
import { AppButton } from './AppButton.tsx';
import { SidebarIcon } from './icons.tsx';

/** Where a column's toggle stands: at its inner edge while it is out, at the middle's edge while it is folded. */
const PLACE = {
  left: { at: 'left-0', out: 'translate-x-[calc(300px-100%-0.5rem)]', folded: 'translate-x-2' },
  right: { at: 'right-0', out: '-translate-x-[calc(340px-100%-0.5rem)]', folded: '-translate-x-2' },
} as const;

/**
 * A side column's toggle (ui/sidePanels.ts) at the foot of the row, at the column's inner edge beside its last line
 * (Lars, 2026-11-03): the running order's at its right, the live column's at its left. Folded, it stays at the
 * middle's edge so the column can come out again, and it travels with the column's edge as it slides.
 */
export function PanelToggle({ side, open, onToggle }: { side: 'left' | 'right'; open: boolean; onToggle: () => void }) {
  const label = t(open ? (side === 'left' ? 'presentation.hideSidebar' : 'presentation.hideLiveColumn') : side === 'left' ? 'presentation.showSidebar' : 'presentation.showLiveColumn');
  const place = PLACE[side];
  return (
    <AppButton
      variant="plain"
      onClick={onToggle}
      aria-label={label}
      title={label}
      aria-pressed={open}
      data-testid={`toggle-${side}`}
      className={`absolute z-10 bottom-safe-1 touch:bottom-safe-0 ${place.at} ${open ? place.out : place.folded} size-8 touch:size-11 rounded-full flex items-center justify-center text-stone-500 dark:text-stone-400 hover:bg-stone-200/60 dark:hover:bg-white/[0.06] cursor-pointer transition-transform duration-300 ease-[cubic-bezier(0.65,0,0.35,1)] motion-reduce:transition-none`}
    >
      <SidebarIcon side={side} className="size-5" />
    </AppButton>
  );
}
