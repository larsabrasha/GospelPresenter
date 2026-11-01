import type { Presentation } from '@gp/core';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { t } from '../../i18n.ts';
import { AppButton } from '../../ui/AppButton.tsx';
import { Dropdown, MENU_ITEM } from '../../ui/Dropdown.tsx';
import { DocumentDuplicateIcon, MusicalNoteIcon, PencilIcon, TrashIcon } from '../../ui/icons.tsx';
import { CloudArrowDownIcon } from '../../ui/KeepOffline.tsx';

/**
 * A presentation's menu (Alternativ): Redigera detaljer, Spara offline, Spara som mall when `onSaveAsTemplate` is given, and to the
 * trash unless it is being presented. The same menu behind the name in the bar on a computer
 * (PresentationBar).
 */
export function PresentationMenu({
  presentation,
  presenting,
  onEditDetails,
  onSaveAsTemplate,
  onKeepOffline,
  onMaterials,
  onTrash,
  button,
  trigger,
  className,
  menuClassName,
}: {
  presentation: Presentation;
  presenting: boolean;
  onEditDetails: () => void;
  onSaveAsTemplate?: () => void;
  /** Spara offline…: the dialog that explains and switches it; not for a template, nor where nothing is kept. */
  onKeepOffline?: () => void;
  /** Noter och länkar…: the songs' sheet music, recordings and links, for the band. */
  onMaterials?: () => void;
  onTrash: () => void;
  button: ButtonHTMLAttributes<HTMLButtonElement>;
  trigger: ReactNode;
  className?: string;
  menuClassName?: string;
}) {
  return (
    <Dropdown className={className ?? 'shrink-0'} menuClassName={`w-56 ${menuClassName ?? ''}`} button={{ ...button, title: t('presentation.options'), 'aria-label': t('presentation.options') }} trigger={trigger}>
      <AppButton variant="plain" role="menuitem" className={MENU_ITEM} onClick={onEditDetails}>
        <PencilIcon className="size-4" />
        {t('presentation.editDetails')}
      </AppButton>
      {onMaterials && (
        <AppButton variant="plain" role="menuitem" className={MENU_ITEM} onClick={onMaterials}>
          <MusicalNoteIcon className="size-4" />
          {t('material.menu')}
        </AppButton>
      )}
      {onKeepOffline && (
        <AppButton variant="plain" role="menuitem" className={MENU_ITEM} onClick={onKeepOffline}>
          <CloudArrowDownIcon className="size-4" />
          {t('offline.keepMenu')}
        </AppButton>
      )}
      {onSaveAsTemplate && (
        <AppButton variant="plain" role="menuitem" className={MENU_ITEM} onClick={onSaveAsTemplate}>
          <DocumentDuplicateIcon className="size-4" />
          {t('templates.saveAs')}
        </AppButton>
      )}
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
