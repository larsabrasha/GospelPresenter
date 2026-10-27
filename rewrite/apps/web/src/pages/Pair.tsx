import { useEffect, useState } from 'react';
import type { PairClaimResponse, SignInResponse } from '@gp/core';
import { api } from '../auth/api.ts';
import { errorText } from '../auth/errors.ts';
import { deviceName, saveDeviceToken } from '../auth/session.ts';
import { t } from '../i18n.ts';
import { AppButton } from '../ui/AppButton.tsx';
import { FloatingInput } from '../ui/Floating.tsx';
import { AUTH_SUBMIT, AUTH_TEXT, AuthCard, FormError } from './AuthCard.tsx';

/**
 * A device the desktop host has not paired sees only this (ADR 0007,
 * decision 6): the code shown on the host, typed here, buys a device token
 * and a session as the user the host chose. On a host this is how a device
 * signs in: never with Google, which the LAN may not reach.
 */
/** A code from the host's QR code (`#pair={code}`). */
const codeFromLink = () => /^#pair=(\d{6})$/.exec(location.hash)?.[1] ?? '';

export function Pair({ paired, onSignedIn }: { paired: boolean; onSignedIn: (r: SignInResponse) => void }) {
  const [code, setCode] = useState(codeFromLink);
  // Out of the address once read, so the code is not kept in the history.
  useEffect(() => {
    if (codeFromLink()) history.replaceState(null, '', location.pathname + location.search);
  }, []);
  const [name, setName] = useState(deviceName());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const digits = code.replace(/\D/g, '');
  return (
    <AuthCard title={t('pair.title')}>
      <p className={AUTH_TEXT}>{t('pair.text')}</p>
      {paired && <p className={AUTH_TEXT}>{t('pair.signIn')}</p>}
      <form
        className="flex flex-col gap-4 pt-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy || digits.length !== 6) return;
          setBusy(true);
          try {
            const r = await api<PairClaimResponse>('POST', '/api/pair/claim', { code: digits, name });
            if (!r.error) {
              saveDeviceToken(r.body.device);
              return onSignedIn(r.body.session);
            }
            setError(errorText(r));
            setCode('');
          } catch {
            setError(t('auth.offline'));
          }
          setBusy(false);
        }}
      >
        <FloatingInput
          id="pair-code"
          label={t('pair.code')}
          inputClassName="font-mono text-xl tracking-[0.3em]"
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          maxLength={7}
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
        <FloatingInput id="pair-name" label={t('pair.name')} maxLength={200} value={name} onChange={(e) => setName(e.target.value)} />
        <FormError text={error} />
        <AppButton variant="plain" type="submit" disabled={busy || digits.length !== 6 || !name.trim()} className={AUTH_SUBMIT}>
          {t('pair.submit')}
        </AppButton>
      </form>
    </AuthCard>
  );
}
