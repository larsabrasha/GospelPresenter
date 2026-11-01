import type { PresentationItem } from '@gp/core';
import { useDb } from '../../db/react.tsx';
import { t } from '../../i18n.ts';
import { AppButton } from '../../ui/AppButton.tsx';
import { useSaveFailed } from '../../ui/AutoSave.tsx';
import { afterWrite } from '../../ui/debounce.ts';

/**
 * An item's title in its section's heading: a click or F2 renames it; Enter or leaving saves, Escape cancels
 * (PRES-A18).
 */
export function ItemTitle({ item, editing, setEditing }: { item: PresentationItem; editing: boolean; setEditing: (on: boolean) => void }) {
  const db = useDb();
  const saveFailed = useSaveFailed();
  if (!editing) {
    return (
      <AppButton variant="plain" onClick={() => setEditing(true)} title={t('presentation.renameShort')} aria-label={t('presentation.renameItem', { title: item.title })} className="min-w-0 truncate text-left uppercase tracking-wide cursor-pointer hover:text-sky-500">
        {item.title}
      </AppButton>
    );
  }
  const save = (v: string) => {
    setEditing(false);
    if (v.trim() && v.trim() !== item.title) afterWrite(db.mutate('renameItem', { itemId: item.id, title: v }), () => {}, saveFailed);
  };
  return (
    <input
      autoFocus
      className="min-w-0 flex-1 max-w-md text-[15px] font-semibold normal-case tracking-normal text-neutral-900 dark:text-neutral-100 px-2 py-0.5 -mx-2 rounded-lg border border-sky-500 bg-transparent dark:bg-raised focus:outline-none focus:ring-2 focus:ring-sky-500"
      maxLength={200}
      aria-label={t('presentation.rename')}
      defaultValue={item.title}
      onBlur={(e) => save(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') save(e.currentTarget.value);
        else if (e.key === 'Escape') {
          // Escape ends the renaming only, one step at a time.
          e.stopPropagation();
          setEditing(false);
        }
      }}
    />
  );
}
