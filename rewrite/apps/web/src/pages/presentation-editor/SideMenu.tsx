import type { Presentation } from '@gp/core';
import type { ReactNode } from 'react';
import { EllipsisOutlineIcon } from '../../ui/icons.tsx';
import { MediaReadiness } from '../../ui/MediaReadiness.tsx';
import { KeepOfflineButton, useKeepOffline } from '../../ui/KeepOffline.tsx';
import { scheduleLine } from '../templates.ts';
import { eventLine } from './eventDate.ts';
import { Description } from './Description.tsx';
import { PresentationMenu } from './PresentationMenu.tsx';

/**
 * The left side: the running order (`children`), and whether this device keeps the presentation and its files. Below
 * `lg` a drawer from the left over a dimmed page, with the name, date (or a template's weekday, time and place) and
 * the … menu above, which a computer has in the bar. "Spara som mall" is there when `onSaveAsTemplate` is.
 */
export function SideMenu({
  presentation,
  menuVisible,
  onHideMenu,
  onEditDetails,
  onSaveAsTemplate,
  onTrash,
  ticking,
  onTicking,
  media = false,
  presenting = false,
  children,
}: {
  presentation: Presentation;
  menuVisible: boolean;
  onHideMenu: () => void;
  onEditDetails: () => void;
  onSaveAsTemplate?: () => void;
  onTrash: () => void;
  /** Select mode (Markera), switched from the menu. */
  ticking: boolean;
  onTicking: (on: boolean) => void;
  /** Whether to say if this device has the files: while it presents the presentation (and while it keeps it offline). */
  media?: boolean;
  /** While presenting the menu leaves out the trash. */
  presenting?: boolean;
  children: ReactNode;
}) {
  const keep = useKeepOffline(presentation);
  return (
    <>
      {/* Below `lg`: the dimmed page behind the drawer; a tap on it closes the drawer. */}
      <div
        className={`bg-black/30 z-[100] absolute inset-0 transition-opacity lg:invisible ${menuVisible ? 'visible opacity-100' : 'invisible opacity-0'}`}
        onClick={onHideMenu}
        data-testid="menu-backdrop"
      />
      <aside
        className={`w-[300px] duration-200 ease-in-out shrink-0 h-full flex flex-col overflow-y-auto bg-surface absolute inset-y-0 left-0 z-[110] shadow-xl lg:relative lg:inset-auto lg:z-10 lg:visible lg:translate-x-0 ${
          menuVisible ? 'visible translate-x-0' : 'invisible -translate-x-full'
        }`}
      >
        <div className="shrink-0 px-4 pt-4 pb-2 space-y-2 lg:pb-0">
          {/* The name, its date and its … here below `lg` only: on a computer they are in the bar (PresentationBar). */}
          <div className="lg:hidden flex items-center justify-between gap-1">
            <h1 className="font-semibold text-lg/7 px-1 min-w-0 line-clamp-2">{presentation.name}</h1>
            <PresentationMenu
              presentation={presentation}
              presenting={presenting}
              onEditDetails={onEditDetails}
              onSaveAsTemplate={onSaveAsTemplate}
              onTrash={onTrash}
              ticking={ticking}
              onTicking={onTicking}
              button={{ className: 'p-2.5 rounded-full hover:bg-raised cursor-pointer text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300' }}
              trigger={<EllipsisOutlineIcon className="size-5" />}
            />
          </div>
          {(() => {
            // "2026-11-01 10:00", or a template's "Söndag 10:00", and the place under it (Sidebar.razor).
            const line = presentation.isTemplate ? scheduleLine(presentation) : eventLine(presentation);
            if (!line && !presentation.location) return null;
            return (
              <div className="lg:hidden px-1 -mt-1 mb-3">
                {line && <div className="text-xs text-neutral-500 dark:text-neutral-400">{line}</div>}
                {presentation.location && <div className="text-xs text-neutral-400 dark:text-neutral-500">{presentation.location}</div>}
              </div>
            );
          })()}
          {/* Whether this device keeps it, and has its files: not the name, so at every width. */}
          {(!presentation.isTemplate || media || keep.kept) && (
            <div className="flex items-center gap-2 px-1 empty:hidden">
              {!presentation.isTemplate && <KeepOfflineButton presentation={presentation} />}
              {(media || keep.kept) && <MediaReadiness presentationId={presentation.id} audio />}
            </div>
          )}
          {presentation.description && <Description key={presentation.description} text={presentation.description} className="mx-1 mb-2" />}
        </div>
        {children}
      </aside>
    </>
  );
}
