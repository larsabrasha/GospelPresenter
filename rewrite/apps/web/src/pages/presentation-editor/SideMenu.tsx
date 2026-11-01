import type { Presentation } from '@gp/core';
import type { ReactNode } from 'react';
import { t } from '../../i18n.ts';
import { AppButton } from '../../ui/AppButton.tsx';
import { MediaReadiness } from '../../ui/MediaReadiness.tsx';
import { useKeepOffline } from '../../ui/KeepOffline.tsx';
import { Description } from './Description.tsx';
import { OfflineStatus } from './OfflineStatus.tsx';

/**
 * The left column on a computer, before and while presenting: Markera, the description, the running order
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
    <aside className="w-[300px] shrink-0 h-full flex flex-col overflow-y-auto bg-surface border-r-[0.5px] border-separator">
      <div className="shrink-0 px-4 pt-4 space-y-2">
        <div className="flex items-center gap-2 px-1 min-h-8">
          {!ticking && (
            <AppButton variant="plain" onClick={() => onTicking(true)} className="ml-auto h-8 px-3 rounded-full text-sm text-sky-500 hover:bg-raised cursor-pointer">
              {t('presentation.tick')}
            </AppButton>
          )}
        </div>
        {presentation.description && <Description key={presentation.description} text={presentation.description} className="mx-1 mb-2" />}
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
