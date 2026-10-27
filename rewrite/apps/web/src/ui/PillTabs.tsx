import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AppButton } from './AppButton.tsx';

/**
 * Tabs as pills in a grey track (Components/PillTabs.razor). The track
 * scrolls sideways when the pills do not fit, with a fade at the edge that
 * has more.
 */
export function PillTabs({ children, className, label, role = 'group' }: { children: ReactNode; className?: string; label?: string; role?: 'group' | 'tablist' }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [fade, setFade] = useState({ left: false, right: false });
  useEffect(() => {
    const el = scroller.current!;
    const update = () => setFade({ left: el.scrollLeft > 1, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 1 });
    update();
    el.addEventListener('scroll', update, { passive: true });
    const resize = new ResizeObserver(update);
    resize.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      resize.disconnect();
    };
  }, []);
  return (
    <div className={`relative bg-neutral-100 dark:bg-neutral-700 rounded-full overflow-hidden md:inline-flex ${className ?? ''}`}>
      <div ref={scroller} role={role} aria-label={label} className="flex gap-1 overflow-x-auto p-1 [scrollbar-width:none]">
        {children}
      </div>
      {fade.left && <div className="absolute top-0 left-0 bottom-0 w-16 rounded-l-full pointer-events-none bg-linear-to-l from-transparent to-neutral-100 dark:to-neutral-700" />}
      {fade.right && <div className="absolute top-0 right-0 bottom-0 w-16 rounded-r-full pointer-events-none bg-linear-to-r from-transparent to-neutral-100 dark:to-neutral-700" />}
    </div>
  );
}

/** One tab of a PillTabs: pressed when it is the one shown. */
export function PillTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <AppButton variant={active ? 'pillActive' : 'pill'} aria-pressed={active} onClick={onClick}>
      {children}
    </AppButton>
  );
}
