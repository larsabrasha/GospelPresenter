import type { LivePointer, Overlay, Slide, Theme } from '@gp/core';
import type { ShownOverlay } from '../../db/queries.ts';
import { t } from '../../i18n.ts';
import type { LiveControl, LiveLink } from '../../live/remote.ts';
import { AppButton } from '../../ui/AppButton.tsx';
import { ChevronLeftIcon } from '../../ui/icons.tsx';
import { SlideView } from '../../ui/SlideView.tsx';
import { CAPTION } from '../../ui/Toggle.tsx';
import { OutputsPanel } from './OutputsPanel.tsx';
import { OverlaysPanel } from './OverlaysPanel.tsx';

const STEP = 'w-13 h-9 touch:h-11 shrink-0 rounded-lg flex items-center justify-center bg-raised cursor-pointer disabled:opacity-35 disabled:cursor-default';

/**
 * The live column on a computer or an iPad lying down (docs/layout-2-0.md): what is used during a service and no
 * more. The picture shown, ‹ Rensa › (Rensa becomes Visa igen while the outputs are black), the next slide, the
 * overlays and the outputs folded to their state. Scenläge, Fjärrstyrning and Avsluta are in the bar.
 */
export function LivePanel({
  owner,
  link,
  live,
  pointer,
  current,
  next,
  overlay,
  theme,
  overlays,
  canStep,
  onStep,
}: {
  owner: { sessionId: string } | null;
  link: LiveLink;
  live: LiveControl;
  pointer: LivePointer;
  current: Slide | null;
  /** The next slide and what it is called, or null at the end. */
  next: { slide: Slide; title: string } | null;
  overlay: ShownOverlay | null;
  theme: Theme;
  overlays: Overlay[];
  canStep: { back: boolean; forward: boolean };
  onStep: (delta: number) => void;
}) {
  return (
    <aside className="w-[340px] shrink-0 overflow-y-auto flex flex-col gap-4 p-4 bg-surface border-l-[0.5px] border-separator" data-testid="live-panel">
      <h2 className={CAPTION}>{t('live.preview')}</h2>
      <div className={`aspect-video rounded-xl overflow-hidden ring-2 ${pointer.black ? 'ring-neutral-500' : 'ring-red-500'}`}>
        <SlideView slide={current} theme={theme} label={false} overlay={overlay} black={pointer.black} />
      </div>
      <div role="toolbar" aria-label={t('live.outputs')} className="flex gap-2">
        <AppButton variant="plain" aria-label={t('live.previous')} disabled={!canStep.back} onClick={() => onStep(-1)} className={STEP}>
          <ChevronLeftIcon className="size-4" />
        </AppButton>
        <AppButton
          variant="plain"
          title={t('live.clear')}
          aria-pressed={pointer.black}
          // Rensa only blacks the outputs; a slide clicked or an arrow shows one again, as ProPresenter's Clear.
          disabled={pointer.black}
          onClick={() => live.set({ black: true })}
          className="flex-1 h-9 touch:h-11 rounded-lg flex items-center justify-center text-sm font-semibold cursor-pointer bg-raised disabled:opacity-40 disabled:cursor-default"
        >
          {t('live.clear')}
        </AppButton>
        <AppButton variant="plain" aria-label={t('live.nextSlide')} disabled={!canStep.forward} onClick={() => onStep(1)} className={STEP}>
          <ChevronLeftIcon className="size-4 rotate-180" />
        </AppButton>
      </div>
      {next && (
        <div className="flex items-center gap-3">
          <span className="w-28 shrink-0 aspect-video rounded-lg overflow-hidden ring-[0.5px] ring-separator">
            <SlideView slide={next.slide} theme={theme} label={false} credits={false} />
          </span>
          <span className="min-w-0 flex flex-col">
            <span className={CAPTION}>{t('live.next')}</span>
            <span className="text-sm truncate">{next.title}</span>
          </span>
        </div>
      )}
      {!!overlays.length && <OverlaysPanel overlays={overlays} pointer={pointer} live={live} />}
      {owner ? <OutputsPanel link={link} sessionId={owner.sessionId} /> : <p className="text-xs text-neutral-500 dark:text-neutral-400 text-center">{t('remote.onlyOwnerStops')}</p>}
    </aside>
  );
}
