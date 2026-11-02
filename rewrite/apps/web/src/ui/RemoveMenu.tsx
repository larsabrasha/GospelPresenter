import { t } from '../i18n.ts';
import { AppButton } from './AppButton.tsx';
import { Dropdown, MENU_ITEM_DANGER } from './Dropdown.tsx';
import { EllipsisIcon, TrashIcon } from './icons.tsx';

const BUTTON = {
  row: 'size-7 flex items-center justify-center rounded-full text-stone-400 hover:text-stone-600 dark:hover:text-stone-300 cursor-pointer',
  picture: 'size-7 flex items-center justify-center rounded-full bg-black/60 text-white cursor-pointer hover:bg-black/80',
};

/** A file's "Fler val för …" menu with Radera (Images.razor): grey in a list's row, a dark round button on a picture. */
export function RemoveMenu({ name, on, onRemove }: { name: string; on: keyof typeof BUTTON; onRemove: () => void }) {
  return (
    <Dropdown menuClassName="min-w-36" button={{ className: BUTTON[on], 'aria-label': t('images.more', { name }) }} trigger={<EllipsisIcon className="size-4" />}>
      <AppButton variant="plain" role="menuitem" className={MENU_ITEM_DANGER} onClick={onRemove}>
        <TrashIcon className="size-4" />
        {t('images.remove')}
      </AppButton>
    </Dropdown>
  );
}
