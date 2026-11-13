import type { Presentation } from '@gp/core';
import { useRef, type ReactNode } from 'react';
import { SyncLine } from '../../TopBar.tsx';
import { MediaReadiness } from '../../ui/MediaReadiness.tsx';
import { useKeepOffline } from '../../ui/KeepOffline.tsx';
import { useFold } from '../../ui/sidePanels.ts';
import { PanelToggle } from '../../ui/PanelToggle.tsx';
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
  open = true,
  onFold,
  children,
}: {
  presentation: Presentation;
  /** Whether to say if this device has the files: while it presents the presentation (and while it keeps it offline). */
  media?: boolean;
  /** The line at the foot while it is kept offline opens the dialog. */
  onOffline: () => void;
  /** Out, or folded off the left edge (ui/sidePanels.ts). */
  open?: boolean;
  /** Folds it away, by the toggle at its foot. */
  onFold?: () => void;
  children: ReactNode;
}) {
  const keep = useKeepOffline(presentation);
  const column = useRef<HTMLElement>(null);
  useFold(column, 'left', open);
  return (
    <aside ref={column} className="flex w-[300px] shrink-0 h-full pt-3 flex-col overflow-hidden bg-sidebar border-r-[0.5px] border-separator">
      {/* The list's scrollbar room and padding too, so the box's edges line up with the rows' (Lars, 2026-11-02). */}
      {presentation.description && (
        <div className="shrink-0 pl-5 pr-(--beside-scrollbar) pt-1 pb-3 overflow-hidden [scrollbar-gutter:stable]">
          <Description key={presentation.description} text={presentation.description} />
        </div>
      )}
      {children}
      {/* The sync, whether it is kept offline, and whether this device has the files while it presents or keeps the
          presentation (a line only when one is missing), and at its right the column's toggle (ui/PanelToggle.tsx). */}
      <div className="shrink-0 flex items-end gap-1 px-2 pt-1 pb-safe-1 empty:hidden">
        <div className="flex-1 min-w-0 empty:hidden">
          {/* One line, one thing at a time: a sync that waits or fails, else whether it is kept offline. */}
          <SyncLine fallback={<OfflineStatus presentation={presentation} onOpen={onOffline} />} />
          {(media || keep.kept) && <MediaReadiness presentationId={presentation.id} audio />}
        </div>
        {onFold && <PanelToggle side="left" onFold={onFold} />}
      </div>
    </aside>
  );
}
