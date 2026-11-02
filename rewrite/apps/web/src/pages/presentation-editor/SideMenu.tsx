import type { Presentation } from '@gp/core';
import type { ReactNode } from 'react';
import { t } from '../../i18n.ts';
import { AppButton } from '../../ui/AppButton.tsx';
import { Dropdown, MENU_ITEM } from '../../ui/Dropdown.tsx';
import { CheckSquareIcon, EllipsisIcon } from '../../ui/icons.tsx';
import { MediaReadiness } from '../../ui/MediaReadiness.tsx';
import { useKeepOffline } from '../../ui/KeepOffline.tsx';
import { Description } from './Description.tsx';
import { OfflineStatus } from './OfflineStatus.tsx';

/**
 * The left column on a computer, before and while presenting: the description with a … at its right that holds
 * Markera (Lars, 2026-11-02), the running order
 * (`children`), and at its foot a quiet line while it is kept offline, and one when this device lacks a file it needs.
 */
export function SideMenu({
  presentation,
  ticking,
  onTicking,
  media = false,
  onOffline,
  children,
}: {
  presentation: Presentation;
  /** Select mode (Markera). */
  ticking: boolean;
  onTicking: (on: boolean) => void;
  /** Whether to say if this device has the files: while it presents the presentation (and while it keeps it offline). */
  media?: boolean;
  /** The line at the foot while it is kept offline opens the dialog. */
  onOffline: () => void;
  children: ReactNode;
}) {
  const keep = useKeepOffline(presentation);
  return (
    <aside className="w-[300px] shrink-0 h-full flex flex-col overflow-hidden bg-sidebar border-r-[0.5px] border-separator">
      <div className="shrink-0 px-4 pt-4 space-y-2">
        <div className="flex items-start gap-1 min-h-8 mb-2">
          <div className="flex-1 min-w-0 pt-1.5">{presentation.description && <Description key={presentation.description} text={presentation.description} />}</div>
          {!ticking && (
            <Dropdown
              menuClassName="w-44 right-0"
              button={{ className: 'size-8 shrink-0 rounded-full flex items-center justify-center cursor-pointer text-stone-500 hover:bg-raised', 'aria-label': t('presentation.listOptions'), title: t('presentation.listOptions') }}
              trigger={<EllipsisIcon className="size-4" />}
            >
              <AppButton variant="plain" role="menuitem" className={MENU_ITEM} onClick={() => onTicking(true)}>
                <CheckSquareIcon className="size-4" />
                {t('presentation.tick')}
              </AppButton>
            </Dropdown>
          )}
        </div>
      </div>
      {children}
      {/* Whether this device has the files, while it presents or keeps the presentation: a line only when one is missing. */}
      <div className="shrink-0 px-2 py-1 empty:hidden">
        <OfflineStatus presentation={presentation} onOpen={onOffline} />
        {(media || keep.kept) && <MediaReadiness presentationId={presentation.id} audio />}
      </div>
    </aside>
  );
}
