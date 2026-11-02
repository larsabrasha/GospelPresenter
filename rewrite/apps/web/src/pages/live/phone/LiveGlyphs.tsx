import type { LivePointer } from '@gp/core';
import { t } from '../../../i18n.ts';
import type { LiveLink } from '../../../live/remote.ts';
import { AppButton } from '../../../ui/AppButton.tsx';
import { DesktopIcon } from '../../../ui/icons.tsx';
import { LIFTED } from '../../../ui/glass.ts';
import { useOutputs } from '../useOutputs.ts';

// Round and lifted as ‹ Rensa ›'s arrows, at the row's right end, so it reads as one of the row's buttons (Lars,
// 2026-11-02: a flat glyph there looked off).
const GLYPH = `size-11 shrink-0 rounded-full flex items-center justify-center cursor-pointer ${LIFTED}`;

/**
 * Visning at the right end of ‹ Rensa ›'s row on a phone: Utgångar and Overlays behind one button, as Control Center
 * gathers what shows (Lars, 2026-11-02). Its screen green while an output is on, a sky dot while an overlay is; a
 * tap opens its sheet. A phone controlling another's session has no outputs of its own: `link` is then null.
 */
export function DisplayGlyph({ link, sessionId, pointer, onClick }: { link: LiveLink | null; sessionId: string; pointer: LivePointer; onClick: () => void }) {
  return (
    <AppButton variant="plain" aria-label={t('live.display')} title={t('live.display')} onClick={onClick} className={`relative ${GLYPH}`}>
      {link ? <OutputsOn link={link} sessionId={sessionId} /> : <DesktopIcon className={`size-[22px] ${OFF}`} />}
      {pointer.overlayId && <span className="absolute top-1.5 right-1.5 size-2.5 rounded-full bg-sky-500 ring-2 ring-surface dark:ring-raised" aria-hidden="true" />}
    </AppButton>
  );
}

const OFF = 'text-stone-500 dark:text-stone-400';

/** The glyph's screen, green while any of this window's outputs is on. */
function OutputsOn({ link, sessionId }: { link: LiveLink; sessionId: string }) {
  const { own, rows } = useOutputs(link, sessionId);
  const on = own.some((x) => x.on) || rows.some((r) => r.sending);
  return <DesktopIcon className={`size-[22px] ${on ? 'text-green-500' : OFF}`} />;
}
