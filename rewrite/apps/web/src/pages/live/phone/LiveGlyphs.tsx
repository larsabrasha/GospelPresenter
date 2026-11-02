import type { LivePointer } from '@gp/core';
import { t } from '../../../i18n.ts';
import type { LiveLink } from '../../../live/remote.ts';
import { AppButton } from '../../../ui/AppButton.tsx';
import { DesktopIcon, SquaresOverlapIcon } from '../../../ui/icons.tsx';
import { useOutputs } from '../useOutputs.ts';

// A flat glyph, no surface or shadow of its own, so it reads apart from ‹ Rensa ›'s lifted buttons, as the AirPlay
// glyph beside a player's controls in Music (Lars, 2026-11-02).
const GLYPH = 'size-11 shrink-0 rounded-full flex items-center justify-center cursor-pointer hover:bg-black/5 dark:hover:bg-white/10';

/** Utgångar at the start of ‹ Rensa ›'s row on a phone: its screen green while any output is on; a tap opens its sheet. */
export function OutputsGlyph({ link, sessionId, onClick }: { link: LiveLink; sessionId: string; onClick: () => void }) {
  const { own, rows } = useOutputs(link, sessionId);
  const on = own.some((x) => x.on) || rows.some((r) => r.sending);
  return (
    <AppButton variant="plain" aria-label={t('live.outputs')} title={t('live.outputs')} aria-pressed={on} onClick={onClick} className={GLYPH}>
      <DesktopIcon className={`size-[22px] ${on ? 'text-green-500' : 'text-stone-500 dark:text-stone-400'}`} />
    </AppButton>
  );
}

/** Overlays at the end of the row: its glyph blue while one is on; a tap opens its sheet. */
export function OverlaysGlyph({ pointer, onClick }: { pointer: LivePointer; onClick: () => void }) {
  return (
    <AppButton variant="plain" aria-label={t('overlays.title')} title={t('overlays.title')} aria-pressed={!!pointer.overlayId} onClick={onClick} className={GLYPH}>
      <SquaresOverlapIcon className={`size-[22px] ${pointer.overlayId ? 'text-sky-500' : 'text-stone-500 dark:text-stone-400'}`} />
    </AppButton>
  );
}
