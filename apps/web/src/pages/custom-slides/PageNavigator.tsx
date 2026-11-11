import type { CustomPage, Slide, Theme } from '@gp/core';
import { t } from '../../i18n.ts';
import { AppButton } from '../../ui/AppButton.tsx';
import { CONTEXT_ROW } from '../../ui/ContextMenu.tsx';
import { PlusIcon } from '../../ui/icons.tsx';
import { HoldMenu } from '../../ui/RemoveMenu.tsx';
import { SlideView } from '../../ui/SlideView.tsx';

// Keynote's slide navigator (docs/custom-slides.md): the pages, numbered, in a column at the left on a computer and an
// iPad, in a row under the page on a phone; a tap opens one, a held finger or a right click its menu, + adds a page.

/** What a page's thumbnail draws: the page, as a slide. */
export const pageSlide = (custom: CustomPage): Slide => ({ key: 'page', kind: 'song', image: null, text: '', verses: null, label: null, credits: null, custom });

export function PageNavigator({
  pages,
  theme,
  at,
  onOpen,
  onAdd,
  onDuplicate,
  onMove,
  onRemove,
}: {
  pages: CustomPage[];
  theme: Theme;
  at: number;
  onOpen: (i: number) => void;
  onAdd: () => void;
  onDuplicate: (i: number) => void;
  onMove: (i: number, to: number) => void;
  onRemove: (i: number) => void;
}) {
  const row = CONTEXT_ROW;
  return (
    <div className="flex @4xl:flex-col gap-3 overflow-x-auto @4xl:overflow-x-visible [scrollbar-width:none] p-1" role="listbox" aria-label={t('slideEditor.pages')}>
      {pages.map((p, i) => (
        <div key={i} className="shrink-0 flex items-start gap-1.5">
          <span className="hidden @4xl:block w-4 pt-1 text-right text-xs tabular-nums text-stone-400">{i + 1}</span>
          <HoldMenu
            label={t('slideEditor.pageMenu', { n: i + 1 })}
            menu={
              <>
                <AppButton variant="plain" role="menuitem" className={row} onClick={() => onDuplicate(i)}>
                  {t('slideEditor.duplicatePage')}
                </AppButton>
                <AppButton variant="plain" role="menuitem" className={row} disabled={i === 0} onClick={() => onMove(i, i - 1)}>
                  {t('slideEditor.pageEarlier')}
                </AppButton>
                <AppButton variant="plain" role="menuitem" className={row} disabled={i === pages.length - 1} onClick={() => onMove(i, i + 1)}>
                  {t('slideEditor.pageLater')}
                </AppButton>
                <div role="separator" className="h-px my-1 bg-separator" />
                <AppButton variant="plain" role="menuitem" className={`${row} text-red-600 dark:text-red-400`} disabled={pages.length === 1} onClick={() => onRemove(i)}>
                  {t('slideEditor.removePage')}
                </AppButton>
              </>
            }
          >
            <AppButton
              variant="plain"
              role="option"
              aria-selected={i === at}
              aria-label={t('slideEditor.page', { n: i + 1 })}
              className={`block w-28 @4xl:w-36 aspect-video rounded-lg overflow-hidden cursor-pointer ring-[3px] ${i === at ? 'ring-sky-500' : 'ring-transparent'}`}
              onClick={() => onOpen(i)}
            >
              <SlideView slide={pageSlide(p)} theme={theme} label={false} credits={false} />
            </AppButton>
          </HoldMenu>
        </div>
      ))}
      <AppButton
        variant="plain"
        aria-label={t('slideEditor.newPage')}
        title={t('slideEditor.newPage')}
        className="shrink-0 @4xl:ml-5.5 w-28 @4xl:w-36 aspect-video rounded-lg border-2 border-dashed border-separator flex items-center justify-center text-stone-400 cursor-pointer hover:text-stone-600"
        onClick={onAdd}
      >
        <PlusIcon className="size-5" />
      </AppButton>
    </div>
  );
}
