import type { Presentation } from '@gp/core';
import type { ReactNode } from 'react';
import { SyncLine } from '../../TopBar.tsx';
import { MediaReadiness } from '../../ui/MediaReadiness.tsx';
import { useKeepOffline } from '../../ui/KeepOffline.tsx';
import { Description } from './Description.tsx';
import { OfflineStatus } from './OfflineStatus.tsx';

/**
 * The left column on a computer, before and while presenting: the description, the running order (`children`, whose
 * rows' … hold Markera: Lars, 2026-11-02), and at its foot a quiet line while it is kept offline, and one when this
 * device lacks a file it needs.
 */
export function SideMenu({
  presentation,
  media = false,
  onOffline,
  children,
}: {
  presentation: Presentation;
  /** Whether to say if this device has the files: while it presents the presentation (and while it keeps it offline). */
  media?: boolean;
  /** The line at the foot while it is kept offline opens the dialog. */
  onOffline: () => void;
  children: ReactNode;
}) {
  const keep = useKeepOffline(presentation);
  return (
    <aside className="w-[300px] shrink-0 h-full pt-3 flex flex-col overflow-hidden bg-sidebar border-r-[0.5px] border-separator">
      {/* The list's scrollbar room and padding too, so the box's edges line up with the rows' (Lars, 2026-11-02). */}
      {presentation.description && (
        <div className="shrink-0 pl-5 pr-(--beside-scrollbar) pt-1 pb-3 overflow-hidden [scrollbar-gutter:stable]">
          <Description key={presentation.description} text={presentation.description} />
        </div>
      )}
      {children}
      {/* The sync, whether it is kept offline, and whether this device has the files while it presents or keeps the
          presentation (a line only when one is missing). */}
      <div className="shrink-0 px-2 py-1 empty:hidden">
        {/* One line, one thing at a time: a sync that waits or fails, else whether it is kept offline. */}
        <SyncLine fallback={<OfflineStatus presentation={presentation} onOpen={onOffline} />} />
        {(media || keep.kept) && <MediaReadiness presentationId={presentation.id} audio />}
      </div>
    </aside>
  );
}
