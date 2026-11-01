import type { Presentation } from '@gp/core';
import { useState } from 'react';
import { orgRemoteControl } from '../../../db/queries.ts';
import { useData } from '../../../db/react.tsx';
import { t } from '../../../i18n.ts';
import { outputWindow } from '../../../live/outputWindow.ts';
import type { LiveControl } from '../../../live/remote.ts';
import { AppButton } from '../../../ui/AppButton.tsx';
import { useConfirm } from '../../../ui/Dialog.tsx';
import { ChevronDownIcon, ChevronLeftIcon, CogIcon, PlayIcon, QrCodeOutlineIcon, StopIcon } from '../../../ui/icons.tsx';
import { href } from '../../../ui/router.ts';
import { Sheet } from '../../../ui/Sheet.tsx';
import { templateDetails } from '../../templates.ts';
import { eventLine } from '../../presentation-editor/eventDate.ts';
import { PresentationMenu } from '../../presentation-editor/PresentationMenu.tsx';
import { RemotePanel } from '../RemotePanel.tsx';
import { SyncCloud } from '../../../TopBar.tsx';

type Open = null | 'remote';

// Round, as every button of the 2.0 layout.
const BAR_BUTTON = 'h-8 touch:h-11 touch:min-w-11 justify-center px-3.5 rounded-full flex items-center gap-1.5 text-[13px] font-semibold cursor-pointer';
const ROUND = 'size-8 touch:size-11 px-0!';

/**
 * A presentation's bar on a computer or an iPad lying down, the same before and while it is presented
 * (docs/layout-2-0.md): "‹ Presentationer" at the left; in the middle its name, LIVE while presented, and when and
 * where, which open the presentation's menu; at the right round icons for Fjärrstyrning (while presented) and
 * Inställningar, and at the far right Starta presentation or Avsluta presentation (which asks first), icon and words.
 * A template has no Starta.
 */
export function PresentationBar({
  id,
  presentation,
  live,
  presenting,
  owner,
  canStart,
  onStart,
  onDetails,
  onSaveAsTemplate,
  onKeepOffline,
  onMaterials,
  onTrash,
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
  onDetails: () => void;
  onSaveAsTemplate?: () => void;
  onKeepOffline?: () => void;
  onMaterials?: () => void;
  onTrash: () => void;
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
      {/* The name opens the presentation's menu, as a title menu on iPadOS and macOS. */}
      <PresentationMenu
        presentation={presentation}
        presenting={presenting}
        onEditDetails={onDetails}
        onSaveAsTemplate={onSaveAsTemplate}
        onKeepOffline={onKeepOffline}
        onMaterials={onMaterials}
        onTrash={onTrash}
        className="min-w-0 justify-self-center"
        menuClassName="left-1/2! right-auto! -translate-x-1/2"
        button={{ className: 'min-w-0 max-w-full px-4 py-1 touch:min-h-11 justify-center rounded-full flex flex-col items-center cursor-pointer hover:bg-raised dark:hover:bg-raised-2 aria-expanded:bg-raised dark:aria-expanded:bg-raised-2' }}
        trigger={
          <>
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
          </>
        }
      />
      <div className="justify-self-end flex items-center gap-2">
        <SyncCloud />
        {/* What is not the presentation's own, round icons: remote control while presenting. */}
        {remote && (
          <AppButton variant="plain" onClick={() => setOpen('remote')} aria-label={t('live.remote')} title={t('live.remote')} aria-haspopup="dialog" className={`${BAR_BUTTON} ${ROUND} bg-raised dark:bg-raised-2`}>
            <QrCodeOutlineIcon className="size-4" />
          </AppButton>
        )}
        {/* Inställningar next to start and stop. */}
        <AppButton variant="plain" href={href({ page: 'admin' })} aria-label={t('nav.admin')} title={t('nav.admin')} className={`${BAR_BUTTON} ${ROUND} bg-raised dark:bg-raised-2`}>
          <CogIcon className="size-4" />
        </AppButton>
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
      {/* Fjärrstyrning in a sheet of its own, centred as iPadOS's form sheet, as on a phone. */}
      {open === 'remote' && remote && owner && (
        <Sheet title={t('live.remote')} onClose={close}>
          <RemotePanel id={id} sessionId={owner.sessionId} name={presentation.name} always={remotePolicy === 'always'} />
        </Sheet>
      )}
    </div>
  );
}
