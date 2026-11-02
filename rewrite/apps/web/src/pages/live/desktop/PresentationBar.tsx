import type { Presentation } from '@gp/core';
import { t } from '../../../i18n.ts';
import { outputWindow } from '../../../live/outputWindow.ts';
import type { LiveControl } from '../../../live/remote.ts';
import { AppButton } from '../../../ui/AppButton.tsx';
import { useConfirm } from '../../../ui/Dialog.tsx';
import { ChevronDownIcon, ChevronLeftIcon, CogIcon, PlayIcon, StopIcon } from '../../../ui/icons.tsx';
import { href } from '../../../ui/router.ts';
import { templateDetails } from '../../templates.ts';
import { eventLine } from '../../presentation-editor/eventDate.ts';
import { PresentationMenu } from '../../presentation-editor/PresentationMenu.tsx';
import { SyncCloud } from '../../../TopBar.tsx';
import { GREEN_SHADOW, LIFTED, RED_SHADOW, ROUND_BACK } from '../../../ui/glass.ts';

// Round, as every button of the 2.0 layout.
const BAR_BUTTON = 'h-9 touch:h-11 touch:min-w-11 justify-center px-3.5 rounded-full flex items-center gap-1.5 text-[13px] font-semibold cursor-pointer';
const ROUND = 'size-9 touch:size-11 px-0!';

/**
 * A presentation's bar on a computer or an iPad lying down, the same before and while it is presented
 * (docs/layout-2-0.md): "‹ Presentationer" at the left; in the middle its name, LIVE while presented, and when and
 * where, which open the presentation's menu; at the right Inställningar as a round icon (Fjärrstyrning is in the live
 * column), and at the far right Starta presentation or Avsluta presentation (which asks first), icon and words.
 * A template has no Starta.
 */
export function PresentationBar({
  presentation,
  live,
  presenting,
  owner,
  canStart,
  onStart,
  onDetails,
  onSaveAsTemplate,
  onMaterials,
  onTrash,
  className,
}: {
  presentation: Presentation;
  live: LiveControl;
  presenting: boolean;
  /** This window's own session, which ■ ends; null while controlling one elsewhere, or not presenting. */
  owner: { sessionId: string } | null;
  canStart: boolean;
  onStart: () => void;
  onDetails: () => void;
  onSaveAsTemplate?: () => void;
  onMaterials?: () => void;
  onTrash: () => void;
  className?: string;
}) {
  const { dialog, ask } = useConfirm();
  const when = presentation.isTemplate ? templateDetails(presentation) : [eventLine(presentation), presentation.location].filter(Boolean).join(' · ');
  const end = async () => {
    const ok = await ask({ title: t('live.end'), text: t('live.endText'), confirm: t('live.end'), compact: true });
    if (!ok) return;
    live.set({ presentationId: null, itemId: null, partIndex: 0, black: false });
    // The output window closes with the presentation (Live.razor, Lars 2026-10-29); the page stays, editing.
    outputWindow().turn(false);
  };
  return (
    <div className={`relative shrink-0 h-13 touch:h-15 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-4 px-4 border-b-[0.5px] border-separator bg-ground ${className ?? ''}`} data-testid="presentation-bar" data-window-bar>
      {dialog}
      {/* Back as iOS 27's: a round ‹ alone (Lars, 2026-11-02). */}
      <a href={href({ page: 'presentations' })} aria-label={t('nav.backToPresentations')} title={t('nav.backToPresentations')} className={`justify-self-start ${ROUND_BACK}`}>
        <ChevronLeftIcon className="size-5" />
      </a>
      {/* The page's heading, for screen readers; the button shows the name. */}
      <h1 className="sr-only">{presentation.name}</h1>
      {/* The name opens the presentation's menu, as a title menu on iPadOS and macOS. */}
      <PresentationMenu
        presentation={presentation}
        presenting={presenting}
        onEditDetails={onDetails}
        onSaveAsTemplate={onSaveAsTemplate}
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
              <ChevronDownIcon className="size-3 shrink-0 text-stone-500" />
            </span>
            {when && (
              <span className="max-w-full truncate text-xs text-stone-500 dark:text-stone-400" data-testid="schedule">
                {when}
              </span>
            )}
          </>
        }
      />
      <div className="justify-self-end flex items-center gap-2">
        <SyncCloud />
        {/* Inställningar next to start and stop. */}
        <AppButton variant="plain" href={href({ page: 'admin' })} aria-label={t('nav.admin')} title={t('nav.admin')} className={`${BAR_BUTTON} ${ROUND} ${LIFTED}`}>
          <CogIcon className="size-4" />
        </AppButton>
        {/* Start and stop at the far right, an icon and its words on a computer: ▶ before, ■ while presented (only
            this window's session ends). */}
        {!presenting && canStart && (
          <AppButton variant="plain" onClick={onStart} className={`${BAR_BUTTON} bg-emerald-500 text-white hover:bg-emerald-600 ${GREEN_SHADOW}`}>
            <PlayIcon className="size-4" />
            {t('presentation.start')}
          </AppButton>
        )}
        {presenting && owner && (
          <AppButton variant="plain" onClick={() => void end()} className={`${BAR_BUTTON} bg-red-50 dark:bg-red-950/40 text-red-500 ${RED_SHADOW}`}>
            <StopIcon className="size-4" />
            {t('live.end')}
          </AppButton>
        )}
      </div>
    </div>
  );
}
