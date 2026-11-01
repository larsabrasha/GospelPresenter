import { useEffect, useEffectEvent, type RefObject } from 'react';

/**
 * Closes a popover or a menu, as macOS does: a press outside `panel` (which still reaches what was pressed, unless
 * `belongs` says the press is the panel's own), or Escape, which closes it and nothing else.
 */
export function useDismiss(panel: RefObject<HTMLElement | null>, onClose: () => void, belongs: (target: Element) => boolean = () => false) {
  const closeNow = useEffectEvent(onClose);
  const own = useEffectEvent(belongs);
  useEffect(() => {
    const press = (e: PointerEvent) => {
      const target = e.target as Element;
      if (!panel.current?.contains(target) && !own(target)) closeNow();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      closeNow();
    };
    document.addEventListener('pointerdown', press, true);
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('pointerdown', press, true);
      document.removeEventListener('keydown', key, true);
    };
  }, [panel]);
}
