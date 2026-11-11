import type { ReactNode } from 'react';
import { t } from '../i18n.ts';
import { AppButton } from './AppButton.tsx';
import { Dropdown, MENU_ITEM } from './Dropdown.tsx';
import { EllipsisOutlineIcon } from './icons.tsx';

/** A choice in a ⋯ menu; `danger` in red, as iOS's destructive actions. */
export interface MoreChoice {
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  onChoose: () => void;
}

/**
 * The ⋯ beside a block's name ("Fler val för Verse 1"): what is done to it less often, kept out of sight until asked
 * for, so the page shows its content rather than its buttons (Lars, 2026-11-02).
 */
export function MoreMenu({ name, choices }: { name: string; choices: MoreChoice[] }) {
  return (
    <Dropdown
      className="shrink-0"
      menuClassName="w-48"
      button={{ className: 'size-8 touch:size-11 rounded-full flex items-center justify-center cursor-pointer text-stone-400 hover:bg-raised hover:text-stone-600 dark:hover:text-stone-200', 'aria-label': t('images.more', { name }), title: t('presentation.options') }}
      trigger={<EllipsisOutlineIcon className="size-4" />}
    >
      {choices.map((c) => (
        <AppButton
          key={c.label}
          variant="plain"
          role="menuitem"
          disabled={c.disabled}
          className={`${MENU_ITEM} disabled:opacity-40 disabled:cursor-default ${c.danger ? 'text-red-500! dark:text-red-400!' : ''}`}
          onClick={c.onChoose}
        >
          {c.icon}
          {c.label}
        </AppButton>
      ))}
    </Dropdown>
  );
}
