import { useState } from 'react';
import { api } from '../auth/api.ts';
import { errorText } from '../auth/errors.ts';
import { deviceName, saveDeviceToken } from '../auth/session.ts';
import { t } from '../i18n.ts';
import { Button } from '../ui/Button.tsx';
import { AuthCard, FormError } from './AuthCard.tsx';

/**
 * A device the desktop host has not paired sees only this (ADR 0007,
 * decision 6): the code shown on the host, typed here, buys a device token.
 */
export function Pair({ onPaired }: { onPaired: () => void }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState(deviceName());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const digits = code.replace(/\D/g, '');
  return (
    <AuthCard title={t('pair.title')}>
      <p>{t('pair.text')}</p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy || digits.length !== 6) return;
          setBusy(true);
          try {
            const r = await api<{ token: string }>('POST', '/pair/claim', { code: digits, name });
            if (!r.error) {
              saveDeviceToken(r.body.token);
              return onPaired();
            }
            setError(errorText(r));
            setCode('');
          } catch {
            setError(t('auth.offline'));
          }
          setBusy(false);
        }}
      >
        <label className="field">
          {t('pair.code')}
          <input className="pair-code" inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={7} value={code} onChange={(e) => setCode(e.target.value)} />
        </label>
        <label className="field">
          {t('pair.name')}
          <input maxLength={200} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <FormError text={error} />
        <div className="row end">
          <Button variant="primary" type="submit" disabled={busy || digits.length !== 6 || !name.trim()}>
            {t('pair.submit')}
          </Button>
        </div>
      </form>
    </AuthCard>
  );
}
