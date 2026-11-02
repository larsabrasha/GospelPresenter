import { useLayoutEffect, useRef, useState } from 'react';
import { t } from '../../i18n.ts';
import { AppButton } from '../../ui/AppButton.tsx';

/**
 * A presentation's description at the top of its running order, where it is plain to see (Lars, 2026-11-01): three
 * lines, and Visa mer when there is more, which unfolds the rest. Grey text on no box of its own, as a list's note in
 * Reminders: a box read as a field or a button (Lars, 2026-11-02).
 */
export function Description({ text, className }: { text: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const [more, setMore] = useState(false);
  const box = useRef<HTMLParagraphElement>(null);
  // Whether three lines hold it all, measured while folded, again as the width changes; a new text remounts it (`key`).
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || open) return;
    const measure = () => setMore(el.scrollHeight > el.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [open]);
  return (
    <div className={`px-2 ${className ?? ''}`} data-testid="description">
      <p ref={box} className={`text-sm/5 whitespace-pre-line text-stone-500 dark:text-stone-400 ${open ? '' : 'line-clamp-3'}`}>
        {text}
      </p>
      {(more || open) && (
        <AppButton variant="plain" aria-expanded={open} onClick={() => setOpen(!open)} className="mt-1 text-sm font-medium text-sky-500 hover:text-sky-600 cursor-pointer">
          {open ? t('presentation.descriptionLess') : t('presentation.descriptionMore')}
        </AppButton>
      )}
    </div>
  );
}
