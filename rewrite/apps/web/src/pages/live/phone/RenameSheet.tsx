import type { PresentationItem } from '@gp/core';
import { useState } from 'react';
import { useDb } from '../../../db/react.tsx';
import { t } from '../../../i18n.ts';
import { AppButton } from '../../../ui/AppButton.tsx';
import { useSaveFailed } from '../../../ui/AutoSave.tsx';
import { afterWrite } from '../../../ui/debounce.ts';
import { Sheet } from '../../../ui/Sheet.tsx';

/** "Byt namn" from an item's … on a phone: the title in a field, Spara (or Enter) keeps it. */
export function RenameSheet({ item, onClose }: { item: PresentationItem; onClose: () => void }) {
  const db = useDb();
  const saveFailed = useSaveFailed();
  const [title, setTitle] = useState(item.title);
  const save = () => {
    if (title.trim() && title.trim() !== item.title) afterWrite(db.mutate('renameItem', { itemId: item.id, title }), () => {}, saveFailed);
    onClose();
  };
  return (
    <Sheet title={t('presentation.renameShort')} onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <input
          autoFocus
          maxLength={200}
          aria-label={t('presentation.rename')}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full h-12 px-4 rounded-[1.375rem] bg-sheet-cell text-[17px] text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
        />
        <AppButton variant="primary" filled type="submit" className="w-full min-h-11">
          {t('common.save')}
        </AppButton>
      </form>
    </Sheet>
  );
}
