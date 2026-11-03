import { useCallback, useEffect, useRef, useState } from 'react';
import type { LiveScreen } from '@gp/core';
import { api } from '../auth/api.ts';
import { t } from '../i18n.ts';
import { setOutput } from '../live/owner.ts';
import { AppButton } from '../ui/AppButton.tsx';
import { CheckIcon, CopyIcon, DesktopIcon, LinkIcon, TickIcon } from '../ui/icons.tsx';
import { SKY_TINT } from '../ui/glass.ts';
import { QrCode } from '../ui/QrCode.tsx';
import { href } from '../ui/router.ts';
import { useServerBase } from '../ui/serverBase.ts';
import { ICON_GROUP, Sheet } from '../ui/Sheet.tsx';
import { useCopied } from '../ui/copyText.ts';

// "Anslut tillfällig skärm" (spec 04 §8): a TV pairs by scanning the QR code
// or by its four-digit code typed here, for this window's session. The new
// screen is switched on at once. A sheet as Fjärrstyrning's (Lars, 2026-11-03):
// the QR code with one line under it, then the address and the code as rows of a
// group, no numbered steps, no "eller".

/** A new QR token every 8 minutes while open, of the 10 it is good for (LIVE-R28). */
const TOKEN_RENEW_MS = 8 * 60_000;
const POLL_MS = 2000;

/** Four one-digit boxes (spec 04 §8): typing moves on, a paste spreads, Backspace goes back, ← and → move, Enter or the fourth digit submits. */
function CodeBoxes({ onComplete }: { onComplete: (code: string) => void }) {
  const [digits, setDigits] = useState(['', '', '', '']);
  const boxes = useRef<(HTMLInputElement | null)[]>([]);
  const put = (from: number, text: string) => {
    const next = [...digits];
    let at = from;
    for (const ch of text.replace(/\D/g, '')) {
      if (at > 3) break;
      next[at++] = ch;
    }
    setDigits(next);
    boxes.current[Math.min(at, 3)]?.focus();
    if (next.every((d) => d)) onComplete(next.join(''));
  };
  return (
    <div className="w-full flex justify-center gap-3" role="group" aria-label={t('pairScreen.code')}>
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            boxes.current[i] = el;
          }}
          className="flex-1 min-w-0 max-w-16 h-14 text-center text-2xl font-bold font-mono rounded-xl border border-transparent bg-stone-900/[0.06] dark:bg-white/[0.08] text-stone-900 dark:text-stone-100 focus:outline-none focus:border-sky-500 focus:ring-4 focus:ring-sky-500/20"
          inputMode="numeric"
          autoComplete="one-time-code"
          aria-label={t('pairScreen.digit', { n: i + 1 })}
          // Not by touch, where the keyboard would come up over the QR code, the usual way in (Lars, 2026-11-03).
          autoFocus={i === 0 && !matchMedia('(pointer: coarse)').matches}
          value={d}
          onChange={(e) => {
            const v = e.target.value;
            if (!v) {
              // Backspace or Delete in a box with a digit: it is emptied, and the focus stays.
              const next = [...digits];
              next[i] = '';
              return setDigits(next);
            }
            // Typed into a full box: the new digit, whichever side of the old one the caret was.
            put(i, d && v.startsWith(d) ? v.slice(d.length) : v.slice(0, 1));
          }}
          onPaste={(e) => {
            e.preventDefault();
            put(i, e.clipboardData.getData('text'));
          }}
          onKeyDown={(e) => {
            if (e.key === 'Backspace' && !d && i > 0) {
              e.preventDefault();
              const next = [...digits];
              next[i - 1] = '';
              setDigits(next);
              boxes.current[i - 1]?.focus();
            } else if (e.key === 'ArrowLeft') boxes.current[i - 1]?.focus();
            else if (e.key === 'ArrowRight') boxes.current[i + 1]?.focus();
            else if (e.key === 'Enter' && digits.every((x) => x)) onComplete(digits.join(''));
          }}
        />
      ))}
    </div>
  );
}

/**
 * The address a TV opens, as a row: what to do, the address under it to read off, and at its end a round copy button,
 * as iOS shows one, which turns to ✓ for two seconds once copied (Lars, 2026-11-03: a tap on the row alone did not say
 * it copies). The whole row copies too; over plain http on the LAN as well (copyText.ts).
 */
function AddressRow({ url }: { url: string }) {
  const [copied, copy] = useCopied();
  return (
    <AppButton
      variant="plain"
      className="w-full min-h-12 px-4 py-2.5 flex items-center gap-3.5 cursor-pointer hover:bg-black/5 dark:hover:bg-white/5"
      onClick={() => copy(url)}
    >
      <LinkIcon className="size-5 shrink-0 text-stone-500 dark:text-stone-400" />
      <span className="flex-1 min-w-0 flex flex-col text-left">
        <span className="text-[17px]">{t('pairScreen.step1')}</span>
        <span aria-label={t('pairScreen.url')} className="text-[13px] break-all select-all text-stone-500 dark:text-stone-400">
          {url}
        </span>
      </span>
      {/* Drawn as a button, inside the row's own (a button cannot hold another); what it does read out by its words. */}
      <span className={`shrink-0 size-9 rounded-full flex items-center justify-center transition-colors ${SKY_TINT}`}>
        {copied ? <CheckIcon className="size-5" /> : <CopyIcon className="size-5" />}
        <span className="sr-only" aria-live="polite">
          {t(copied ? 'pairScreen.copied' : 'displays.copy')}
        </span>
      </span>
    </AppButton>
  );
}

export function PairScreenDialog({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const base = useServerBase();
  const [token, setToken] = useState<string | null>(null);
  const [paired, setPaired] = useState<LiveScreen | null>(null);
  const [wrong, setWrong] = useState(0);
  const [busy, setBusy] = useState(false);

  const done = useCallback((screen: LiveScreen) => {
    setOutput(screen.id, true);
    setPaired(screen);
  }, []);

  // The QR token: made on open, renewed while open, dropped on close or success (LIVE-R28). Dropping a token
  // a TV used meanwhile takes that screen in all the same, so a scan is never lost to a renewal or a close.
  useEffect(() => {
    if (paired) return;
    let current: string | null = null;
    let stopped = false;
    const took = (screen: LiveScreen | null | undefined) => {
      if (!screen) return;
      if (stopped) setOutput(screen.id, true); // the dialog is gone; the screen is on, with its ✕ under Utgångar
      else done(screen);
    };
    const drop = (used: string) =>
      void api<{ screen: LiveScreen | null }>('DELETE', `/api/live/screens/token/${used}?session=${encodeURIComponent(sessionId)}`).then((r) => took(r.body?.screen));
    const make = async () => {
      const r = await api<{ token: string }>('POST', '/api/live/screens/token');
      if (!r.body?.token) return;
      if (stopped) return drop(r.body.token);
      if (current) drop(current);
      current = r.body.token;
      setToken(current);
    };
    void make();
    const renew = setInterval(() => void make(), TOKEN_RENEW_MS);
    const poll = setInterval(async () => {
      const asked = current;
      if (!asked) return;
      const r = await api<{ screen: LiveScreen | null }>('GET', `/api/live/screens/token/${asked}?session=${encodeURIComponent(sessionId)}`);
      if (!r.body?.screen) return;
      if (current === asked) current = null; // used: nothing to drop
      took(r.body.screen);
    }, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(renew);
      clearInterval(poll);
      if (current) drop(current);
    };
  }, [sessionId, paired, done]);

  const submit = async (pin: string) => {
    if (busy) return;
    setBusy(true);
    const r = await api<{ screen?: LiveScreen }>('POST', '/api/live/screens/claim', { pin, sessionId });
    setBusy(false);
    if (r.body?.screen) done(r.body.screen);
    else setWrong((n) => n + 1);
  };

  const displayUrl = `${base}${href({ page: 'display', id: null, name: null, token: null })}`;
  return (
    <Sheet title={t('pairScreen.title')} onClose={onClose}>
      {paired ? (
        <div className="flex flex-col items-center text-center gap-3 pt-2 pb-4" role="status">
          <div className="size-20 rounded-full bg-green-500 flex items-center justify-center">
            <TickIcon className="size-12 text-white" />
          </div>
          <div className="font-semibold text-lg">{t('pairScreen.done')}</div>
          <div className="text-sm text-stone-500 dark:text-stone-400">{t('pairScreen.doneText')}</div>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <div className="space-y-2">
            <div className="flex justify-center">
              <div className="bg-white p-3 rounded-lg w-48 h-48 flex items-center justify-center [&>svg]:w-full [&>svg]:h-full [&_.qr]:m-0">
                {token && <QrCode value={`${base}${href({ page: 'display', id: null, name: null, token })}`} label={t('pairScreen.qr')} />}
              </div>
            </div>
            <p className="text-sm text-stone-500 dark:text-stone-400 text-center">{t('pairScreen.scanHint')}</p>
          </div>
          <div className={ICON_GROUP}>
            <AddressRow url={displayUrl} />
            {/* The boxes centred under the row's line, across the whole card, as iOS sets a code's fields (Lars, 2026-11-03). */}
            <div className="px-4 pt-3 pb-4 flex flex-col gap-3.5">
              <span className="flex items-center gap-3.5 text-[17px]">
                <DesktopIcon className="size-5 shrink-0 text-stone-500 dark:text-stone-400" />
                {t('pairScreen.step2')}
              </span>
              {/* A wrong code empties the boxes (LIVE-A19): new boxes, focused again. */}
              <CodeBoxes onComplete={(pin) => void submit(pin)} key={wrong} />
            </div>
          </div>
          {wrong > 0 && <p className="px-4 -mt-2 text-sm text-red-500 dark:text-red-400">{t('pairScreen.wrong')}</p>}
        </div>
      )}
    </Sheet>
  );
}
