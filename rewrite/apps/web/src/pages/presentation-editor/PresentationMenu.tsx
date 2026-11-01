import type { Presentation } from '@gp/core';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { t } from '../../i18n.ts';
import { AppButton } from '../../ui/AppButton.tsx';
import { Dropdown, MENU_ITEM } from '../../ui/Dropdown.tsx';
import { CheckboxIcon, DocumentDuplicateIcon, PencilIcon, TrashIcon } from '../../ui/icons.tsx';

/**
 * A presentation's … (Alternativ): Redigera detaljer, Spara som mall when `onSaveAsTemplate` is given, Markera,
 * `extra` (what presenting adds), and to the trash unless it is being presented. The same menu in the bar on a
 * computer (PresentationBar) and in the drawer below `lg` (SideMenu).
 */
export function PresentationMenu({
  presentation,
  presenting,
  onEditDetails,
  onSaveAsTemplate,
  onTrash,
  ticking,
  onTicking,
  extra,
  button,
  trigger,
}: {
  presentation: Presentation;
  presenting: boolean;
  onEditDetails: () => void;
  onSaveAsTemplate?: () => void;
  onTrash: () => void;
  ticking: boolean;
  onTicking: (on: boolean) => void;
  extra?: ReactNode;
  button: ButtonHTMLAttributes<HTMLButtonElement>;
  trigger: ReactNode;
}) {
  return (
    <Dropdown className="shrink-0" menuClassName="w-56" button={{ ...button, title: t('presentation.options'), 'aria-label': t('presentation.options') }} trigger={trigger}>
      <AppButton variant="plain" role="menuitem" className={MENU_ITEM} onClick={onEditDetails}>
        <PencilIcon className="size-4" />
        {t('presentation.editDetails')}
      </AppButton>
      {onSaveAsTemplate && (
        <AppButton variant="plain" role="menuitem" className={MENU_ITEM} onClick={onSaveAsTemplate}>
          <DocumentDuplicateIcon className="size-4" />
          {t('templates.saveAs')}
        </AppButton>
      )}
      <div className="border-t-[0.5px] border-neutral-200 dark:border-neutral-600" />
      <AppButton variant="plain" role="menuitemcheckbox" aria-checked={ticking} className={MENU_ITEM} onClick={() => onTicking(!ticking)}>
        <CheckboxIcon checked={ticking} className="size-4" />
        {t('presentation.tick')}
      </AppButton>
      {extra && <div className="border-t-[0.5px] border-neutral-200 dark:border-neutral-600" />}
      {extra}
      {!presenting && (
        <>
          <div className="border-t-[0.5px] border-neutral-200 dark:border-neutral-600" />
          <AppButton variant="plain" role="menuitem" className={`${MENU_ITEM} text-red-500! dark:text-red-400!`} onClick={onTrash}>
            <TrashIcon className="size-4" strokeWidth={1.5} />
            {t(presentation.isTemplate ? 'templates.trash' : 'presentation.trash')}
          </AppButton>
        </>
      )}
    </Dropdown>
  );
}
