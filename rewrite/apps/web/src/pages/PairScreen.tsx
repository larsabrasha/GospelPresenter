import { useCallback, useEffect, useRef, useState } from 'react';
import type { LiveScreen } from '@gp/core';
import { api } from '../auth/api.ts';
import { t } from '../i18n.ts';
import { setOutput } from '../live/owner.ts';
import { AppButton } from '../ui/AppButton.tsx';
import { CopyField } from '../ui/CopyField.tsx';
import { Dialog, DialogButtons } from '../ui/Dialog.tsx';
import { TickIcon } from '../ui/icons.tsx';
import { QrCode } from '../ui/QrCode.tsx';
import { href } from '../ui/router.ts';
import { useServerBase } from '../ui/serverBase.ts';
import { useToast } from '../ui/Toast.tsx';

// "Anslut tillfällig skärm" (spec 04 §8): a TV pairs by scanning the QR code
// or by its four-digit code typed here, for this window's session. The new
// screen is switched on at once.

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
    <div className="flex gap-3 pl-7 pt-1" role="group" aria-label={t('pairScreen.code')}>
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            boxes.current[i] = el;
          }}
          className="w-12 h-14 text-center text-2xl font-bold font-mono rounded-lg border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-700 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
          inputMode="numeric"
          autoComplete="one-time-code"
          aria-label={t('pairScreen.digit', { n: i + 1 })}
          autoFocus={i === 0}
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

export function PairScreenDialog({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const base = useServerBase();
  const toast = useToast();
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

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast(t('displays.copied'));
    } catch {
      // No clipboard over plain http on the LAN: the address is on screen to copy by hand.
    }
  };

  const displayUrl = `${base}${href({ page: 'display', id: null, name: null, token: null })}`;
  return (
    <Dialog title={t('pairScreen.title')} onClose={onClose} maxWidthClass="max-w-sm">
      {paired ? (
        <div className="flex flex-col items-center text-center gap-4 py-4" role="status">
          <div className="size-20 rounded-full bg-green-500 flex items-center justify-center">
            <TickIcon className="size-12 text-white" />
          </div>
          <div className="font-semibold text-lg">{t('pairScreen.done')}</div>
          <div className="text-sm text-neutral-500 dark:text-neutral-400">{t('pairScreen.doneText')}</div>
          <AppButton onClick={onClose}>{t('common.close')}</AppButton>
        </div>
      ) : (
        <>
          <div className="space-y-3">
            <h3 className="font-medium text-sm/5 text-neutral-800 dark:text-neutral-100">{t('pairScreen.scan')}</h3>
            <p className="text-sm text-neutral-500 dark:text-neutral-400">{t('pairScreen.scanHint')}</p>
            <div className="flex justify-center">
              <div className="bg-white p-3 rounded-lg w-48 h-48 flex items-center justify-center [&>svg]:w-full [&>svg]:h-full">
                {token && <QrCode value={`${base}${href({ page: 'display', id: null, name: null, token })}`} label={t('pairScreen.qr')} />}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-neutral-200 dark:bg-neutral-700" />
            <span className="text-xs uppercase tracking-widest text-neutral-400 dark:text-neutral-500">{t('pairScreen.or')}</span>
            <div className="h-px flex-1 bg-neutral-200 dark:bg-neutral-700" />
          </div>
          <div className="space-y-4">
            <h3 className="font-medium text-sm/5 text-neutral-800 dark:text-neutral-100">{t('pairScreen.manual')}</h3>
            <div className="space-y-2">
              <Step n={1} text={t('pairScreen.step1')} />
              <div className="pl-7">
                <CopyField value={displayUrl} label={t('pairScreen.url')} copyLabel={t('displays.copy')} onCopy={() => void copy(displayUrl)} />
              </div>
            </div>
            <div className="space-y-2">
              <Step n={2} text={t('pairScreen.step2')} />
              {/* A wrong code empties the boxes (LIVE-A19): new boxes, focused again. */}
              <CodeBoxes onComplete={(pin) => void submit(pin)} key={wrong} />
            </div>
          </div>
          {wrong > 0 && <p className="text-sm text-red-500 dark:text-red-400">{t('pairScreen.wrong')}</p>}
          <DialogButtons>
            <AppButton variant="cancel" onClick={onClose}>
              {t('common.cancel')}
            </AppButton>
          </DialogButtons>
        </>
      )}
    </Dialog>
  );
}

/** A numbered step: the number in a small sky circle (PairingCodeDialog.razor). */
function Step({ n, text }: { n: number; text: string }) {
  return (
    <div className="flex items-start gap-2 text-sm text-neutral-700 dark:text-neutral-200">
      <span className="size-5 rounded-full bg-sky-100 dark:bg-sky-900/40 text-sky-600 dark:text-sky-400 flex items-center justify-center text-xs font-semibold shrink-0">{n}</span>
      <span>{text}</span>
    </div>
  );
}
