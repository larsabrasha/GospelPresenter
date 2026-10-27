import { useCallback, useEffect, useRef, useState } from 'react';
import type { LiveScreen } from '@gp/core';
import { api } from '../auth/api.ts';
import { t } from '../i18n.ts';
import { setOutput } from '../live/owner.ts';
import { Button } from '../ui/Button.tsx';
import { Dialog } from '../ui/Dialog.tsx';
import { QrCode } from '../ui/QrCode.tsx';
import { href } from '../ui/router.ts';
import { useServerBase } from '../ui/serverBase.ts';

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
    <div className="row code-boxes" role="group" aria-label={t('pairScreen.code')}>
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            boxes.current[i] = el;
          }}
          className="code-box"
          inputMode="numeric"
          autoComplete="one-time-code"
          aria-label={t('pairScreen.digit', { n: i + 1 })}
          autoFocus={i === 0}
          value={d}
          onChange={(e) => put(i, e.target.value.slice(-1))}
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
  const [token, setToken] = useState<string | null>(null);
  const [paired, setPaired] = useState<LiveScreen | null>(null);
  const [wrong, setWrong] = useState(0);
  const [busy, setBusy] = useState(false);

  const done = useCallback((screen: LiveScreen) => {
    setOutput(screen.id, true);
    setPaired(screen);
  }, []);

  // The QR token: made on open, renewed while open, dropped on close or success (LIVE-R28).
  useEffect(() => {
    if (paired) return;
    let current: string | null = null;
    let stopped = false;
    const make = async () => {
      const r = await api<{ token: string }>('POST', '/api/live/screens/token');
      if (stopped || !r.body?.token) return;
      if (current) void api('DELETE', `/api/live/screens/token/${current}`);
      current = r.body.token;
      setToken(current);
    };
    void make();
    const renew = setInterval(() => void make(), TOKEN_RENEW_MS);
    const poll = setInterval(async () => {
      if (!current) return;
      const r = await api<{ screen: LiveScreen | null }>('GET', `/api/live/screens/token/${current}?session=${encodeURIComponent(sessionId)}`);
      if (!stopped && r.body?.screen) {
        current = null; // used: nothing to drop
        done(r.body.screen);
      }
    }, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(renew);
      clearInterval(poll);
      if (current) void api('DELETE', `/api/live/screens/token/${current}`);
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
    <Dialog title={t('pairScreen.title')} onClose={onClose}>
      {paired ? (
        <div className="pair-done" role="status">
          <p className="ok">✓ {t('pairScreen.done')}</p>
          <p className="muted">{t('pairScreen.doneText')}</p>
          <div className="row end">
            <Button variant="primary" onClick={onClose}>
              {t('common.close')}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <h3>{t('pairScreen.scan')}</h3>
          {token && <QrCode value={`${base}${href({ page: 'display', id: null, name: null, token })}`} label={t('pairScreen.qr')} />}
          <h3>{t('pairScreen.manual')}</h3>
          <p className="muted small">{t('pairScreen.step1')}</p>
          <input readOnly value={displayUrl} aria-label={t('pairScreen.url')} onFocus={(e) => e.currentTarget.select()} />
          <p className="muted small">{t('pairScreen.step2')}</p>
          {/* A wrong code empties the boxes (LIVE-A19): new boxes, focused again. */}
          <CodeBoxes onComplete={(pin) => void submit(pin)} key={wrong} />
          {wrong > 0 && <p className="error">{t('pairScreen.wrong')}</p>}
          <div className="row end">
            <Button onClick={onClose}>{t('common.cancel')}</Button>
          </div>
        </>
      )}
    </Dialog>
  );
}
