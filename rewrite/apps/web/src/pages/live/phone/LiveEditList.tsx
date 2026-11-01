import type { PresentationItem } from '@gp/core';
import { useDb } from '../../../db/react.tsx';
import { t } from '../../../i18n.ts';
import { useSaveFailed } from '../../../ui/AutoSave.tsx';
import { AppButton } from '../../../ui/AppButton.tsx';
import { afterWrite } from '../../../ui/debounce.ts';
import { GripIcon, ItemIcon } from '../../../ui/icons.tsx';
import { useSortable } from '../../../ui/sortable.ts';

/**
 * Redigera while presenting on a phone (docs/layout-2-0.md): one row per item, moved by ≡ (a finger holds it a
 * moment first, so the list still scrolls) and removed by the red minus; the shown item can move but not be removed.
 */
export function LiveEditList({ items, shownId, onRemove }: { items: PresentationItem[]; shownId: string | null; onRemove: (item: PresentationItem) => void }) {
  const db = useDb();
  const saveFailed = useSaveFailed();
  const { listRef, rowStyle, handle } = useSortable<HTMLOListElement>((from, to) =>
    afterWrite(db.mutate('moveItem', { itemId: items[from]!.id, by: to - from }), () => {}, saveFailed),
  );
  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-4 pt-3 pb-10" data-testid="live-edit">
      <ol ref={listRef} aria-label={t('live.order')} className="rounded-[1.375rem] overflow-hidden bg-surface divide-y-[0.5px] divide-separator">
        {items.map((item, i) => {
          const shown = item.id === shownId;
          return (
            <li key={item.id} data-sort-row style={rowStyle(i)} className="relative h-15 flex items-center gap-3 pl-3.5 pr-1.5 bg-surface">
              <AppButton
                variant="plain"
                aria-label={t('live.removeItem', { title: item.title })}
                disabled={shown}
                onClick={() => onRemove(item)}
                className="size-11 -ml-2 shrink-0 flex items-center justify-center cursor-pointer disabled:cursor-default"
              >
                <span className={`size-5.5 rounded-full flex items-center justify-center ${shown ? 'bg-neutral-300 dark:bg-neutral-600' : 'bg-red-500'}`}>
                  <span className="w-2.5 h-0.5 rounded-full bg-white" />
                </span>
              </AppButton>
              <ItemIcon type={item.type} className="size-4 shrink-0 text-neutral-500 dark:text-neutral-400" />
              <span className="flex-1 min-w-0 flex items-center gap-2 text-[17px]">
                <span className="truncate">{item.title}</span>
                {shown && <span className="size-2 rounded-full bg-red-500 shrink-0" aria-label={t('live.badge')} />}
              </span>
              <div
                {...handle(i)}
                data-testid="drag-handle"
                title={t('live.moveItem', { title: item.title })}
                className="size-11 shrink-0 flex items-center justify-center touch-none select-none cursor-grab active:cursor-grabbing text-neutral-400 dark:text-neutral-500"
              >
                <GripIcon className="size-5" />
              </div>
            </li>
          );
        })}
      </ol>
      <p className="px-4 pt-2 text-[13px] text-neutral-500 dark:text-neutral-400">{t('live.editHint')}</p>
    </div>
  );
}
