import type { Presentation } from '@gp/core';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { t } from '../../i18n.ts';
import { AppButton } from '../../ui/AppButton.tsx';
import { Dropdown, MENU_ITEM } from '../../ui/Dropdown.tsx';
import { DocumentDuplicateIcon, MusicalNoteIcon, PencilIcon, TrashIcon } from '../../ui/icons.tsx';

const SEPARATOR = 'border-t-[0.5px] border-stone-200 dark:border-stone-600';

/**
 * A presentation's menu (Alternativ), the same behind the name in the bar on a computer (PresentationBar), in groups:
 * Redigera detaljer… and Noter och länkar; Spara som mall… when `onSaveAsTemplate` is given; and to the trash unless it
 * is being presented. "…" only where a dialog asks first. Spara offline is not here: the line at the foot of the left
 * column (OfflineStatus) and the start page's cloud have it.
 */
export function PresentationMenu({
  presentation,
  presenting,
  onEditDetails,
  onSaveAsTemplate,
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
  /** Noter och länkar: the songs' sheet music, recordings and links, for the band. */
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
        {t('presentation.editDetailsMenu')}
      </AppButton>
      {onMaterials && (
        <AppButton variant="plain" role="menuitem" className={MENU_ITEM} onClick={onMaterials}>
          <MusicalNoteIcon className="size-4" />
          {t('material.title')}
        </AppButton>
      )}
      {onSaveAsTemplate && (
        <>
          <div className={SEPARATOR} />
          <AppButton variant="plain" role="menuitem" className={MENU_ITEM} onClick={onSaveAsTemplate}>
            <DocumentDuplicateIcon className="size-4" />
            {t('templates.saveAsMenu')}
          </AppButton>
        </>
      )}
      {!presenting && (
        <>
          <div className={SEPARATOR} />
          <AppButton variant="plain" role="menuitem" className={`${MENU_ITEM} text-red-500! dark:text-red-400!`} onClick={onTrash}>
            <TrashIcon className="size-4" strokeWidth={1.5} />
            {t(presentation.isTemplate ? 'templates.trash' : 'presentation.trash')}
          </AppButton>
        </>
      )}
    </Dropdown>
  );
}
