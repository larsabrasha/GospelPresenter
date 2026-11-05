import type { Presentation } from '@gp/core';
import { t } from '../../i18n.ts';
import { outputWindow } from '../../live/outputWindow.ts';
import type { LiveControl } from '../../live/remote.ts';
import { AppButton } from '../../ui/AppButton.tsx';
import { SearchButton } from '../../ui/CommandPalette.tsx';
import { useWide } from '../../ui/useWide.ts';
import { useConfirm } from '../../ui/Dialog.tsx';
import { ChevronDownIcon, ChevronLeftIcon, CogIcon, PlayIcon, StopIcon } from '../../ui/icons.tsx';
import { backToTemplates, href } from '../../ui/router.ts';
import { templateDetails } from '../templates.ts';
import { PresentationMenu } from '../presentation-editor/PresentationMenu.tsx';
import { markLiveStarting, playLiveLeaving } from './liveMotion.ts';
import { SyncCloud } from '../../TopBar.tsx';
import { GREEN_SHADOW, LIFTED, RED_SHADOW, ROUND_BACK } from '../../ui/glass.ts';

// Round, as every button of the 2.0 layout; on a phone an icon alone, its words for screen readers. 36 px to a mouse
// and 44 to a finger at every width, as the ‹ beside them (Lars, 2026-11-02).
const BAR_BUTTON = 'h-9 touch:h-11 touch:min-w-11 justify-center px-3.5 max-lg:px-0 max-lg:size-9 max-lg:touch:size-11 rounded-full flex items-center gap-1.5 text-[13px] font-semibold cursor-pointer';
const ROUND = 'size-9 touch:size-11 px-0!';
/** The soft fade under a phone's bar, over what scrolls beneath it. */
const FADE = 'max-lg:after:absolute max-lg:after:inset-x-0 max-lg:after:top-full max-lg:after:h-5 max-lg:after:bg-linear-to-b max-lg:after:from-ground max-lg:after:to-transparent max-lg:after:pointer-events-none';

/**
 * A presentation's bar, one on a computer and a phone, before and while it is presented (docs/layout-2-0.md; Lars,
 * 2026-11-02: one bar, told apart by width): a round ‹ at the left; in the middle its name, LIVE while following
 * another's session, and when and where, which open the presentation's menu; at the right Inställningar as a round
 * icon, and at the far right Starta presentation or Avsluta
 * presentation (which asks first), icon and words on a computer, the icon alone on a phone. A template has no Starta.
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
}) {
  const { dialog, ask } = useConfirm();
  const wide = useWide();
  // "2026-11-01 10:00 · Stora salen"; a phone has no room for the date, so it is a part of its own that hides there.
  const date = presentation.isTemplate ? null : presentation.eventDate;
  const rest = presentation.isTemplate ? templateDetails(presentation) : [presentation.time, presentation.location].filter(Boolean).join(' · ');
  const when = date || rest;
  const end = async () => {
    const ok = await ask({ title: t('live.end'), text: t('live.endText'), confirm: t('live.end'), compact: true });
    if (!ok) return;
    // The picture fades and its area closes first (liveMotion.ts), then the presentation ends.
    await playLiveLeaving();
    live.set({ presentationId: null, itemId: null, partIndex: 0, black: false });
    // The output window closes with the presentation (Live.razor, Lars 2026-10-29); the page stays, editing.
    outputWindow().turn(false);
  };
  return (
    // On a phone it floats over the slides, with a soft fade from the page's colour under it rather than an edge, as
    // iOS 26's bars (Lars, 2026-11-02); not while presenting, when the picture stands still under it and the fade only
    // dimmed its red frame. The name in the middle of the bar, not of the room between ‹ and the buttons at the right,
    // which are wider (Lars, 2026-11-03): the sides share what is left alike, each no narrower than what is in it, and
    // a long name is cut short.
    <div
      className={`relative z-20 shrink-0 h-15 lg:h-13 lg:touch:h-15 grid grid-cols-[minmax(max-content,1fr)_minmax(0,auto)_minmax(max-content,1fr)] items-center gap-2 lg:gap-4 px-4 bg-ground lg:border-b-[0.5px] lg:border-separator ${presenting ? '' : FADE}`}
      data-testid="presentation-bar"
      data-window-bar
    >
      {dialog}
      {/* Back as iOS 27's: a round ‹ alone (Lars, 2026-11-02). */}
      {/* A template's goes back to Mallar, where templates are kept. The sync's cloud beside it, when there is one:
          the left was empty and the right full (Lars, 2026-11-05). */}
      <div className="justify-self-start flex items-center gap-3">
      <a
        href={href({ page: presentation.isTemplate ? 'templates' : 'presentations' })}
        onClick={(e) => {
          if (!presentation.isTemplate) return;
          e.preventDefault();
          backToTemplates();
        }}
        aria-label={t(presentation.isTemplate ? 'nav.backToTemplates' : 'nav.backToPresentations')}
        title={t(presentation.isTemplate ? 'nav.backToTemplates' : 'nav.backToPresentations')}
        className={ROUND_BACK}
      >
        <ChevronLeftIcon className="size-5" />
      </a>
      <SyncCloud />
      </div>
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
        className="min-w-0 max-w-full justify-self-center"
        menuClassName="left-1/2! right-auto! -translate-x-1/2"
        button={{ className: 'min-w-0 max-w-full px-2 lg:px-4 py-1 h-11 lg:h-auto touch:min-h-11 justify-center rounded-full flex flex-col items-center cursor-pointer overflow-hidden lg:hover:bg-stone-200/60 lg:dark:hover:bg-raised-2 lg:aria-expanded:bg-stone-200/60 lg:dark:aria-expanded:bg-raised-2' }}
        trigger={
          <>
            <span className="max-w-full flex items-center gap-1 lg:gap-2 whitespace-nowrap">
              <span className="text-[17px]/[22px] lg:text-[15px] font-semibold truncate">{presentation.name}</span>
              {/* LIVE only where this window has no ■ (following another's session): there the red ■ and the picture's
                  red frame say it (Lars, 2026-11-02). Until the session ends, also while Släck has blacked the outputs. */}
              {presenting && !owner && (
                <span className="shrink-0 flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wide bg-red-500/15 text-red-500">
                  <span className="size-1.5 rounded-full bg-red-500" />
                  {t('live.badge')}
                </span>
              )}
              <ChevronDownIcon className="size-3.5 lg:size-3 shrink-0 text-stone-500" />
            </span>
            {when && (
              <span className="max-w-full truncate text-xs/4 text-stone-500 dark:text-stone-400" data-testid="schedule">
                {date && <span className="max-lg:hidden">{rest ? `${date}${presentation.time ? ' ' : ' · '}` : date}</span>}
                {rest}
              </span>
            )}
          </>
        }
      />
      <div className="justify-self-end flex items-center gap-3">
        {/* On a phone the search floats at the bottom left instead (PhoneLive), the bar has no room. */}
        {wide && <SearchButton className={`${BAR_BUTTON} ${ROUND} ${LIFTED}`} iconClassName="size-5" />}
        {/* Inställningar next to start and stop, on a phone too. */}
        <AppButton variant="plain" href={href({ page: 'admin' })} aria-label={t('nav.admin')} title={t('nav.admin')} className={`${BAR_BUTTON} ${ROUND} ${LIFTED}`}>
          <CogIcon className="size-5" />
        </AppButton>
        {/* Start and stop at the far right: ▶ before, ■ while presented (only this window's session ends). */}
        {!presenting && canStart && (
          <AppButton
            variant="plain"
            onClick={() => {
              markLiveStarting();
              onStart();
            }}
            className={`${BAR_BUTTON} bg-emerald-500 text-white hover:bg-emerald-600 ${GREEN_SHADOW}`}>
            <PlayIcon className="size-5" />
            <span className="max-lg:sr-only">{t('presentation.start')}</span>
          </AppButton>
        )}
        {presenting && owner && (
          // Filled red as the question's own Avsluta presentation (Lars, 2026-11-02), as ▶ is filled green.
          <AppButton variant="plain" onClick={() => void end()} className={`${BAR_BUTTON} bg-red-500 text-white hover:bg-red-600 ${RED_SHADOW}`}>
            <StopIcon className="size-5" />
            <span className="max-lg:sr-only">{t('live.end')}</span>
          </AppButton>
        )}
      </div>
    </div>
  );
}
