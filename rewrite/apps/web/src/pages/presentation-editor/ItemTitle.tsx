import type { PresentationItem } from '@gp/core';
import { useDb } from '../../db/react.tsx';
import { t } from '../../i18n.ts';

/** The selected item's title: click or F2 to rename; Enter or leaving saves, Escape cancels (PRES-A18). */
export function ItemTitle({ item, editing, setEditing }: { item: PresentationItem; editing: boolean; setEditing: (on: boolean) => void }) {
  const db = useDb();
  if (!editing) {
    return (
      <h2 className="text-xl/7 font-semibold cursor-pointer hover:text-sky-500 truncate min-w-0" onClick={() => setEditing(true)} title={t('presentation.rename')}>
        {item.title}
      </h2>
    );
  }
  const save = (v: string) => {
    setEditing(false);
    if (v.trim() && v.trim() !== item.title) void db.mutate('renameItem', { itemId: item.id, title: v });
  };
  return (
    <input
      autoFocus
      className="min-w-0 flex-1 text-xl font-semibold px-2 py-1 -mx-2 rounded-lg border border-sky-500 bg-transparent dark:bg-neutral-700 focus:outline-none focus:ring-2 focus:ring-sky-500"
      maxLength={200}
      aria-label={t('presentation.rename')}
      defaultValue={item.title}
      onBlur={(e) => save(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') save(e.currentTarget.value);
        else if (e.key === 'Escape') setEditing(false);
      }}
    />
  );
}
