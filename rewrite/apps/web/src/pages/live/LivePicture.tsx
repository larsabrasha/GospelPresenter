import type { CustomPage, Slide, Theme } from '@gp/core';
import type { ReactNode } from 'react';
import { t } from '../../i18n.ts';
import { AppButton } from '../../ui/AppButton.tsx';
import { LIFTED } from '../../ui/glass.ts';
import { ChevronLeftIcon } from '../../ui/icons.tsx';
import { SlideView } from '../../ui/SlideView.tsx';

/**
 * The picture shown and ‹ Rensa › under it, the same on a phone and a computer (docs/layout-2-0.md): a red ring while
 * the outputs show it, grey while Rensa has blacked them; round lifted arrows, and Rensa a capsule of plain text between
 * them, as iOS 27's player. Rensa only blacks the outputs; a part chosen or an arrow shows one again, as ProPresenter's
 * Clear. `children` (a video's player line) goes between the picture and the buttons. `trailing` (a phone's Visning)
 * stands at the right end of a row as wide as the column, the buttons kept in its middle, Rensa as wide as there is
 * room for, up to 144 px. Without `onStep` there are no arrows: a phone shows a part by a tap on it, and the arrows
 * were seldom used there and drew the eye (Lars, 2026-11-03). The picture is `data-live-picture`, which fades in
 * after Starta presentation once its area has taken its room (liveMotion.ts, called by the area's owner).
 */
export function LivePicture({
  slide,
  theme,
  overlay,
  black,
  canStep,
  onStep,
  onClear,
  testId,
  maxWidthClass = 'max-w-[640px]',
  trailing,
  leading,
  children,
}: {
  slide: Slide | null;
  theme: Theme;
  overlay: CustomPage | null;
  black: boolean;
  canStep?: { back: boolean; forward: boolean };
  onStep?: (delta: number) => void;
  onClear: () => void;
  testId?: string;
  /** How wide the picture may grow; a phone caps it by the screen's height. */
  maxWidthClass?: string;
  trailing?: ReactNode;
  /** With `trailing`: what stands at the row's left end (a phone's Beskrivning); an empty place as wide, without. */
  leading?: ReactNode;
  children?: ReactNode;
}) {
  // 36 px on a computer, as every button there; 44 by touch and on a phone (Lars, 2026-11-02).
  const arrow = `size-11 lg:size-9 lg:touch:size-11 shrink-0 rounded-full flex items-center justify-center cursor-pointer disabled:opacity-35 disabled:cursor-default ${LIFTED}`;
  return (
    <div className="flex flex-col gap-3 items-center">
      <div data-live-picture className={`w-full ${maxWidthClass} aspect-video rounded-2xl overflow-hidden ring-2 ${black ? 'ring-stone-500' : 'ring-red-500'}`} data-testid={testId}>
        <SlideView slide={slide} theme={theme} label={false} overlay={overlay} black={black} />
      </div>
      {children}
      {/* ‹ Rensa › in the middle (a phone: Rensa alone); on a phone Visning at the row's right end, round and lifted as the arrows; the picture
          stays free of buttons (Lars, 2026-11-02). */}
      <div role="toolbar" aria-label={t('live.outputs')} className={`flex items-center h-11 lg:h-9 lg:touch:h-11 ${trailing ? 'w-full max-w-[640px] justify-between gap-2' : 'justify-center'}`}>
        {/* An empty place as wide as Visning keeps the middle in the middle. */}
        {trailing && (leading ?? <span className="size-11 shrink-0" />)}
        <div className={`flex items-center ${trailing ? 'flex-1 min-w-0 justify-center gap-2' : 'gap-4'}`}>
          {onStep && (
            <AppButton variant="plain" aria-label={t('live.previous')} disabled={!canStep?.back} onClick={() => onStep(-1)} className={arrow}>
              <ChevronLeftIcon className="size-5" />
            </AppButton>
          )}
          <AppButton
            variant="plain"
            aria-pressed={black}
            disabled={black}
            onClick={onClear}
            className={`h-11 lg:h-9 lg:touch:h-11 ${trailing ? 'flex-1 min-w-0 max-w-36 px-3' : 'min-w-36 px-6'} rounded-full flex items-center justify-center text-[15px] lg:text-sm font-semibold cursor-pointer disabled:opacity-40 disabled:cursor-default ${LIFTED}`}
          >
            {t('live.clear')}
          </AppButton>
          {onStep && (
            <AppButton variant="plain" aria-label={t('live.nextSlide')} disabled={!canStep?.forward} onClick={() => onStep(1)} className={arrow}>
              <ChevronLeftIcon className="size-5 rotate-180" />
            </AppButton>
          )}
        </div>
        {trailing}
      </div>
    </div>
  );
}
