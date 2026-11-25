import { useLayoutEffect, useRef, useState } from 'react';
import { t } from '../../i18n.ts';
import { AppButton } from '../../ui/AppButton.tsx';
import { CAPTION } from '../../ui/Group.tsx';
import { PencilIcon } from '../../ui/icons.tsx';

/**
 * A presentation's description at the top of its running order, where it is plain to see (Lars, 2026-11-01): three
 * lines, and Visa mer when there is more, which unfolds the rest. A flat card a step lighter than the column, as a group
 * in iOS's Settings, with no shadow or border (Lars, 2026-11-02: a sunken box read as a field). Visa mer at the end of the
 * last line, and Visa mindre under the text at the same right edge, so the two stand where each other was (Lars,
 * 2026-11-25). Unfolded, `onEdit` adds a pencil at the left of Visa mindre, which opens Redigera detaljer: a pencil, as
 * the add dialog's song has, rather than a second word beside Visa mindre (Lars, 2026-11-25). Under the caption
 * Beskrivning, as a group's, so a description that lists the service is not read as the running order under it (Lars,
 * 2026-11-25).
 */
export function Description({ text, className, onEdit }: { text: string; className?: string; onEdit?: () => void }) {
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
    <div role="group" aria-label={t('presentation.description')} className={`space-y-1.5 ${className ?? ''}`}>
      <h3 className={CAPTION}>{t('presentation.description')}</h3>
    <div className="relative px-4 py-3 rounded-2xl bg-surface" data-testid="description">
      <p ref={box} className={`text-[13px]/[18px] whitespace-pre-line text-stone-500 dark:text-stone-400 ${open ? '' : 'line-clamp-3'}`}>
        {text}
      </p>
      {open ? (
        // The pencil's 32 px reach down into the card's padding, never up over the text (Lars, 2026-11-25).
        <div className="mt-1 -mb-2 flex items-center justify-between gap-3">
          {onEdit ? (
            <AppButton
              variant="plain"
              onClick={onEdit}
              aria-label={t('presentation.descriptionEdit')}
              title={t('presentation.descriptionEdit')}
              // Its pencil where the text starts, a finger's room around it.
              className="-ml-2 size-8 rounded-full flex items-center justify-center text-sky-500 hover:text-sky-600 hover:bg-raised-2 cursor-pointer"
            >
              <PencilIcon className="size-4" />
            </AppButton>
          ) : (
            <span />
          )}
          <AppButton variant="plain" aria-expanded onClick={() => setOpen(false)} className="text-[13px]/[18px] font-medium text-sky-500 hover:text-sky-600 cursor-pointer">
            {t('presentation.descriptionLess')}
          </AppButton>
        </div>
      ) : (
        more && (
          <AppButton
            variant="plain"
            aria-expanded={false}
            onClick={() => setOpen(true)}
            // Over the end of the last line, the words under it fading into the card.
            className="absolute right-4 bottom-2.5 pl-8 bg-linear-to-r from-transparent via-surface via-40% to-surface text-[13px]/[18px] font-medium text-sky-500 hover:text-sky-600 cursor-pointer"
          >
            {t('presentation.descriptionMore')}
          </AppButton>
        )
      )}
    </div>
    </div>
  );
}
