import type { Slide, Theme } from '@gp/core';
import type { ReactNode } from 'react';
import type { ShownOverlay } from '../../db/queries.ts';
import { t } from '../../i18n.ts';
import { AppButton } from '../../ui/AppButton.tsx';
import { GLASS } from '../../ui/glass.ts';
import { ChevronLeftIcon } from '../../ui/icons.tsx';
import { SlideView } from '../../ui/SlideView.tsx';

/**
 * The picture shown and ‹ Rensa › under it, the same on a phone and a computer (docs/layout-2-0.md): a red ring while
 * the outputs show it, grey while Rensa has blacked them; round glass arrows, and Rensa a capsule of plain text between
 * them, as iOS 27's player. Rensa only blacks the outputs; a part chosen or an arrow shows one again, as ProPresenter's
 * Clear. `children` (a video's player line) goes between the picture and the buttons.
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
  children,
}: {
  slide: Slide | null;
  theme: Theme;
  overlay: ShownOverlay | null;
  black: boolean;
  canStep: { back: boolean; forward: boolean };
  onStep: (delta: number) => void;
  onClear: () => void;
  testId?: string;
  children?: ReactNode;
}) {
  const arrow = `size-11 rounded-full flex items-center justify-center cursor-pointer disabled:opacity-35 disabled:cursor-default ${GLASS}`;
  return (
    <div className="flex flex-col gap-3 items-center">
      <div className={`w-full max-w-[640px] aspect-video rounded-2xl overflow-hidden ring-2 ${black ? 'ring-neutral-500' : 'ring-red-500'}`} data-testid={testId}>
        <SlideView slide={slide} theme={theme} label={false} overlay={overlay} black={black} />
      </div>
      {children}
      <div role="toolbar" aria-label={t('live.outputs')} className="flex items-center justify-center gap-4 h-11">
        <AppButton variant="plain" aria-label={t('live.previous')} disabled={!canStep.back} onClick={() => onStep(-1)} className={arrow}>
          <ChevronLeftIcon className="size-5" />
        </AppButton>
        <AppButton
          variant="plain"
          aria-pressed={black}
          disabled={black}
          onClick={onClear}
          className={`h-11 min-w-36 px-6 rounded-full flex items-center justify-center text-[15px] font-semibold cursor-pointer disabled:opacity-40 disabled:cursor-default ${GLASS}`}
        >
          {t('live.clear')}
        </AppButton>
        <AppButton variant="plain" aria-label={t('live.nextSlide')} disabled={!canStep.forward} onClick={() => onStep(1)} className={arrow}>
          <ChevronLeftIcon className="size-5 rotate-180" />
        </AppButton>
      </div>
    </div>
  );
}
