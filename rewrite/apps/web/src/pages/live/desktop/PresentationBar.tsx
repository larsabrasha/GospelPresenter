import type { Presentation } from '@gp/core';
import { useRef, useState, type ReactNode } from 'react';
import { orgRemoteControl } from '../../../db/queries.ts';
import { useData } from '../../../db/react.tsx';
import { t } from '../../../i18n.ts';
import { outputWindow } from '../../../live/outputWindow.ts';
import type { LiveControl } from '../../../live/remote.ts';
import { AppButton } from '../../../ui/AppButton.tsx';
import { useConfirm } from '../../../ui/Dialog.tsx';
import { ArrowsPointingOutIcon, ChevronDownIcon, ChevronLeftIcon, EllipsisIcon, PlayIcon, StopIcon } from '../../../ui/icons.tsx';
import { MENU_ITEM } from '../../../ui/Dropdown.tsx';
import { href } from '../../../ui/router.ts';
import { useDismiss } from '../../../ui/useDismiss.ts';
import { templateDetails } from '../../templates.ts';
import { eventLine } from '../../presentation-editor/eventDate.ts';
import { PresentationMenu } from '../../presentation-editor/PresentationMenu.tsx';
import { RemotePanel } from '../RemotePanel.tsx';
import { SyncCloud } from '../../../TopBar.tsx';

type Open = null | 'about' | 'remote';

/**
 * A small panel under a button of the bar, as macOS draws a popover. A press outside it closes it and still
 * reaches what was pressed; a press on the bar is the bar's (its buttons open, switch or close the popover), and one
 * in a dialog the popover opened is the popover's.
 * Escape closes it, and only it.
 */
function Popover({ onClose, className, children }: { onClose: () => void; className: string; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  // A press on the bar is the bar's; a dialog opened from the popover is drawn elsewhere in the page, but belongs to it.
  useDismiss(panel, onClose, (target) => !!target.closest('[data-testid="presentation-bar"], [role="dialog"]'));
  return (
    <div ref={panel} className={`absolute z-[131] top-12 touch:top-16 rounded-xl bg-surface dark:bg-raised shadow-2xl ring-[0.5px] ring-separator text-sm ${className}`}>
      {children}
    </div>
  );
}

// Round, as every button of the 2.0 layout.
const BAR_BUTTON = 'h-8 touch:h-11 touch:min-w-11 justify-center px-3.5 rounded-full flex items-center gap-1.5 text-[13px] font-semibold cursor-pointer';

/**
 * A presentation's bar on a computer or an iPad lying down, the same before and while it is presented
 * (docs/layout-2-0.md): "‹ Presentationer" at the left; in the middle its name, LIVE while presented, and when and
 * where, which open the details; at the right the presentation's round …, Scenläge while presented, and at the far
 * right Starta presentation or Avsluta presentation (which asks first), icon and words. A template has no Starta.
 */
export function PresentationBar({
  id,
  presentation,
  live,
  presenting,
  owner,
  canStart,
  onStart,
  onStage,
  onDetails,
  onSaveAsTemplate,
  onTrash,
  ticking,
  onTicking,
  className,
}: {
  id: string;
  presentation: Presentation;
  live: LiveControl;
  presenting: boolean;
  /** This window's own session, which ■ ends; null while controlling one elsewhere, or not presenting. */
  owner: { sessionId: string } | null;
  canStart: boolean;
  onStart: () => void;
  onStage: () => void;
  onDetails: () => void;
  onSaveAsTemplate?: () => void;
  onTrash: () => void;
  ticking: boolean;
  onTicking: (on: boolean) => void;
  className?: string;
}) {
  const [open, setOpen] = useState<Open>(null);
  const { dialog, ask } = useConfirm();
  const remotePolicy = useData(orgRemoteControl, []);
  const when = presentation.isTemplate ? templateDetails(presentation) : [eventLine(presentation), presentation.location].filter(Boolean).join(' · ');
  const close = () => setOpen(null);
  const remote = presenting && owner && remotePolicy && remotePolicy !== 'never';
  const end = async () => {
    const ok = await ask({ title: t('live.end'), text: t('live.endText'), confirm: t('live.end'), compact: true });
    if (!ok) return;
    live.set({ presentationId: null, itemId: null, partIndex: 0, black: false });
    // The output window closes with the presentation (Live.razor, Lars 2026-10-29); the page stays, editing.
    outputWindow().turn(false);
  };
  return (
    <div className={`relative shrink-0 h-13 touch:h-15 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-4 px-4 border-b-[0.5px] border-separator bg-surface ${className ?? ''}`} data-testid="presentation-bar">
      {dialog}
      <a href={href({ page: 'presentations' })} aria-label={t('nav.backToPresentations')} className="justify-self-start flex items-center gap-1 -ml-1 touch:min-h-11 text-sm font-medium text-sky-500 hover:text-sky-600 no-underline whitespace-nowrap">
        <ChevronLeftIcon className="size-5" />
        {t('nav.presentations')}
      </a>
      {/* The page's heading, for screen readers; the button shows the name. */}
      <h1 className="sr-only">{presentation.name}</h1>
      <AppButton
        variant="plain"
        aria-label={t('live.about')}
        aria-expanded={open === 'about'}
        onClick={() => setOpen(open === 'about' ? null : 'about')}
        className={`min-w-0 px-4 py-1 touch:min-h-11 justify-center rounded-full flex flex-col items-center cursor-pointer ${open === 'about' ? 'bg-raised dark:bg-raised-2' : ''}`}
      >
        <span className="max-w-full flex items-center gap-2 whitespace-nowrap">
          <span className="text-[15px] font-semibold truncate">{presentation.name}</span>
          {/* LIVE until Avsluta, also while Rensa has blacked the outputs: the presentation is still running. */}
          {presenting && (
            <span className="shrink-0 flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wide bg-red-500/15 text-red-500">
              <span className="size-1.5 rounded-full bg-red-500" />
              {t('live.badge')}
            </span>
          )}
          <ChevronDownIcon className="size-3 shrink-0 text-neutral-500" />
        </span>
        {when && (
          <span className="max-w-full truncate text-xs text-neutral-500 dark:text-neutral-400" data-testid="schedule">
            {when}
          </span>
        )}
      </AppButton>
      <div className="justify-self-end flex items-center gap-2">
        <SyncCloud />
        <PresentationMenu
          presentation={presentation}
          presenting={presenting}
          onEditDetails={onDetails}
          onSaveAsTemplate={onSaveAsTemplate}
          onTrash={onTrash}
          ticking={ticking}
          onTicking={onTicking}
          button={{ className: `${BAR_BUTTON} size-8 touch:size-11 px-0! bg-raised dark:bg-raised-2` }}
          trigger={<EllipsisIcon className="size-4" />}
          extra={
            <>
              {remote && (
                <AppButton variant="plain" role="menuitem" className={MENU_ITEM} onClick={() => setOpen('remote')}>
                  {t('live.remote')}…
                </AppButton>
              )}
              <a href={href({ page: 'admin' })} role="menuitem" className={MENU_ITEM}>
                {t('nav.admin')}
              </a>
            </>
          }
        />
        {presenting && (
          <AppButton variant="plain" onClick={onStage} className={`${BAR_BUTTON} bg-raised dark:bg-raised-2`}>
            <ArrowsPointingOutIcon className="size-4" />
            {t('live.stage')}
          </AppButton>
        )}
        {/* Start and stop at the far right, an icon and its words on a computer: ▶ before, ■ while presented (only
            this window's session ends). */}
        {!presenting && canStart && (
          <AppButton variant="plain" onClick={onStart} className={`${BAR_BUTTON} bg-emerald-500 text-white hover:bg-emerald-600`}>
            <PlayIcon className="size-4" />
            {t('presentation.start')}
          </AppButton>
        )}
        {presenting && owner && (
          <AppButton variant="plain" onClick={() => void end()} className={`${BAR_BUTTON} bg-red-500/15 text-red-500`}>
            <StopIcon className="size-4" />
            {t('live.end')}
          </AppButton>
        )}
      </div>
      {open === 'about' && (
        <Popover onClose={close} className="left-1/2 -translate-x-1/2 w-96 p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[15px] font-semibold truncate">{presentation.name}</span>
            <AppButton variant="plain" onClick={() => (close(), onDetails())} className="h-7 touch:h-11 px-3 rounded-full bg-raised dark:bg-raised-2 text-[13px] font-semibold cursor-pointer">
              {t('live.editDetails')}
            </AppButton>
          </div>
          {presentation.description ? <p className="text-[13px]/relaxed whitespace-pre-line">{presentation.description}</p> : when && <p className="text-[13px]">{when}</p>}
        </Popover>
      )}
      {open === 'remote' && remote && owner && (
        <Popover onClose={close} className="right-4 w-80 p-4">
          <RemotePanel id={id} sessionId={owner.sessionId} name={presentation.name} always={remotePolicy === 'always'} />
        </Popover>
      )}
    </div>
  );
}
