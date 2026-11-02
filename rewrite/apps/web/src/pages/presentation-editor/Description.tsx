import { useLayoutEffect, useRef, useState } from 'react';
import { t } from '../../i18n.ts';
import { AppButton } from '../../ui/AppButton.tsx';

/**
 * A presentation's description at the top of its running order, where it is plain to see (Lars, 2026-11-01): three
 * lines, and Visa mer when there is more, which unfolds the rest. A flat card a step lighter than the column, as a group
 * in iOS's Settings, with no shadow or border (Lars, 2026-11-02: a sunken box read as a field); its mer at the end of the
 * last line, as the App Store's.
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
    <div className={`relative px-3 py-2.5 rounded-xl bg-surface ${className ?? ''}`} data-testid="description">
      <p ref={box} className={`text-[13px]/[18px] whitespace-pre-line text-stone-500 dark:text-stone-400 ${open ? '' : 'line-clamp-3'}`}>
        {text}
      </p>
      {(more || open) && (
        <AppButton
          variant="plain"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          // Folded, over the end of the last line, the words under it fading into the card.
          className={`text-[13px]/[18px] font-medium text-sky-500 hover:text-sky-600 cursor-pointer ${open ? 'mt-0.5' : 'absolute right-3 bottom-2.5 pl-8 bg-linear-to-r from-transparent via-surface via-40% to-surface'}`}
        >
          {open ? t('presentation.descriptionLess') : t('presentation.descriptionMore')}
        </AppButton>
      )}
    </div>
  );
}
