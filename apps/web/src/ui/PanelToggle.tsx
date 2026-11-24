import { t } from '../i18n.ts';
import { AppButton } from './AppButton.tsx';
import { LIFTED } from './glass.ts';
import { SidebarIcon } from './icons.tsx';

// A side column's toggles (ui/sidePanels.ts; Lars, 2026-11-03): one in the column's foot that folds it away, quiet as
// the line beside it, and one floating at the middle's edge while it is folded that brings it out. One shows at a time:
// the first is the column's own, so it comes and goes with it, a start and an end included.

const QUIET = 'text-stone-500 dark:text-stone-400 hover:bg-stone-200/60 dark:hover:bg-white/[0.06]';

/** Göm sidofält or Göm livekolumnen, at the column's inner edge in its foot. */
export function PanelToggle({ side, onFold }: { side: 'left' | 'right'; onFold: () => void }) {
  const label = t(side === 'left' ? 'presentation.hideSidebar' : 'presentation.hideLiveColumn');
  return (
    <AppButton variant="plain" onClick={onFold} aria-label={label} title={label} className={`shrink-0 size-9 touch:size-11 rounded-full flex items-center justify-center cursor-pointer ${QUIET}`}>
      <SidebarIcon side={side} className="size-5" />
    </AppButton>
  );
}

/**
 * Visa sidofält or Visa livekolumnen, floating at the middle's foot on the folded column's side, round and lifted as
 * the bar's buttons; it comes in as the column has slid away (app.css `.float-in`).
 */
export function FloatingPanelToggle({ side, onShow }: { side: 'left' | 'right'; onShow: () => void }) {
  const label = t(side === 'left' ? 'presentation.showSidebar' : 'presentation.showLiveColumn');
  return (
    <AppButton
      variant="plain"
      onClick={onShow}
      aria-label={label}
      title={label}
      className={`float-in absolute z-10 bottom-safe-4 ${side === 'left' ? 'left-4' : 'right-4'} size-9 touch:size-11 rounded-full flex items-center justify-center cursor-pointer text-stone-700 dark:text-stone-200 ${LIFTED}`}
    >
      <SidebarIcon side={side} className="size-5" />
    </AppButton>
  );
}
