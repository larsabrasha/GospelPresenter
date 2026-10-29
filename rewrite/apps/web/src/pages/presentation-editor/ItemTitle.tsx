import type { PresentationItem } from '@gp/core';
import { useDb } from '../../db/react.tsx';
import { t } from '../../i18n.ts';
import { useSaveFailed } from '../../ui/AutoSave.tsx';
import { afterWrite } from '../../ui/debounce.ts';

/**
 * The selected item's title: click (from `lg`) or F2 to rename; Enter or leaving saves, Escape
 * cancels (PRES-A18). Below `lg` the title is only text (PresentationHeader.razor).
 */
export function ItemTitle({ item, editing, setEditing }: { item: PresentationItem; editing: boolean; setEditing: (on: boolean) => void }) {
  const db = useDb();
  const saveFailed = useSaveFailed();
  if (!editing) {
    return (
      <h2 className="text-xl/7 font-semibold truncate min-w-0">
        <span className="lg:hidden">{item.title}</span>
        <span className="hidden lg:inline cursor-pointer hover:text-sky-500 pointer-events-auto" onClick={() => setEditing(true)} title={t('presentation.renameShort')}>
          {item.title}
        </span>
      </h2>
    );
  }
  const save = (v: string) => {
    setEditing(false);
    if (v.trim() && v.trim() !== item.title) afterWrite(db.mutate('renameItem', { itemId: item.id, title: v }), () => {}, saveFailed);
  };
  return (
    <input
      autoFocus
      className="pointer-events-auto min-w-0 flex-1 text-xl font-semibold px-2 py-1 -mx-2 rounded-lg border border-sky-500 bg-transparent dark:bg-neutral-700 focus:outline-none focus:ring-2 focus:ring-sky-500"
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
