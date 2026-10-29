import type { Presentation } from '@gp/core';
import type { ReactNode } from 'react';
import { t } from '../../i18n.ts';
import { AppButton } from '../../ui/AppButton.tsx';
import { Dropdown, MENU_ITEM } from '../../ui/Dropdown.tsx';
import { DocumentDuplicateIcon, EllipsisOutlineIcon, PencilIcon, TrashIcon } from '../../ui/icons.tsx';
import { KeepOfflineItem, MediaReadiness, OfflinePill, type useKeepOffline } from '../../ui/MediaReadiness.tsx';
import { scheduleLine } from '../templates.ts';
import { formatEventDate } from './eventDate.ts';

/**
 * The left side: the presentation's name, date and ⋯ menu above the running order
 * (`children`), or a template's weekday, time and place. Below `lg` a drawer from
 * the left over a dimmed page. "Spara som mall" is there when `onSaveAsTemplate` is.
 */
export function SideMenu({
  presentation,
  keep,
  menuVisible,
  onHideMenu,
  onEditDetails,
  onSaveAsTemplate,
  onTrash,
  children,
}: {
  presentation: Presentation;
  keep: ReturnType<typeof useKeepOffline>;
  menuVisible: boolean;
  onHideMenu: () => void;
  onEditDetails: () => void;
  onSaveAsTemplate?: () => void;
  onTrash: () => void;
  children: ReactNode;
}) {
  return (
    <>
      {/* Below `lg`: the dimmed page behind the drawer; a tap on it closes the drawer. */}
      <div
        className={`bg-black/30 z-[100] absolute inset-0 transition-opacity lg:invisible ${menuVisible ? 'visible opacity-100' : 'invisible opacity-0'}`}
        onClick={onHideMenu}
        data-testid="menu-backdrop"
      />
      <aside
        className={`w-[300px] duration-200 ease-in-out shrink-0 h-full flex flex-col overflow-y-auto bg-white dark:bg-neutral-800 absolute inset-y-0 left-0 z-[110] shadow-xl lg:relative lg:inset-auto lg:z-10 lg:visible lg:translate-x-0 ${
          menuVisible ? 'visible translate-x-0' : 'invisible -translate-x-full'
        }`}
      >
        <div className="shrink-0 px-4 pt-4 pb-2 space-y-2">
          <div className="flex items-center justify-between gap-1">
            <div className="flex items-center gap-2 min-w-0">
              <h1 className="font-semibold text-lg/7 px-1 min-w-0 line-clamp-2">{presentation.name}</h1>
              {keep.kept && <OfflinePill />}
            </div>
            <Dropdown
              className="shrink-0"
              menuClassName="w-64"
              button={{
                className: 'p-2.5 rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-700 cursor-pointer text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300',
                title: t('presentation.options'),
                'aria-label': t('presentation.options'),
              }}
              trigger={<EllipsisOutlineIcon className="size-5" />}
            >
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
              {!presentation.isTemplate && <KeepOfflineItem keep={keep} />}
              <div className="border-t-[0.5px] border-neutral-200 dark:border-neutral-600" />
              <AppButton variant="plain" role="menuitem" className={`${MENU_ITEM} text-red-500! dark:text-red-400!`} onClick={onTrash}>
                <TrashIcon className="size-4" strokeWidth={1.5} />
                {t(presentation.isTemplate ? 'templates.trash' : 'presentation.trash')}
              </AppButton>
            </Dropdown>
          </div>
          {presentation.eventDate && (
            <p className="px-1 -mt-1 text-xs text-neutral-500 dark:text-neutral-400" data-testid="schedule">
              {formatEventDate(presentation.eventDate)}
            </p>
          )}
          {presentation.isTemplate && (scheduleLine(presentation) || presentation.location) && (
            <div className="px-1 -mt-1" data-testid="schedule">
              {scheduleLine(presentation) && <div className="text-xs text-neutral-500 dark:text-neutral-400">{scheduleLine(presentation)}</div>}
              {presentation.location && <div className="text-xs text-neutral-400 dark:text-neutral-500">{presentation.location}</div>}
            </div>
          )}
          <div className="px-1">
            <MediaReadiness presentationId={presentation.id} audio />
          </div>
        </div>
        {children}
      </aside>
    </>
  );
}
