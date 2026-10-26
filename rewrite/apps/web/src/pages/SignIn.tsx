import { useState } from 'react';
import type { SignInResponse } from '@gp/core';
import { api } from '../auth/api.ts';
import { errorText } from '../auth/errors.ts';
import { deviceName } from '../auth/session.ts';
import { t } from '../i18n.ts';
import { Button } from '../ui/Button.tsx';
import { AuthCard, FormError } from './AuthCard.tsx';

/** "Logga in" with email and password. There is no self-registration: accounts come from invites (AUTH-R4). */
export function SignIn({ onSignedIn }: { onSignedIn: (r: SignInResponse) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <AuthCard title={t('auth.signIn')}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          setError(null);
          try {
            const r = await api<SignInResponse>('POST', '/auth/signin', { email, password, deviceName: deviceName() });
            if (r.error) setError(errorText(r));
            else return onSignedIn(r.body);
          } catch {
            setError(t('auth.offline'));
          }
          setBusy(false);
        }}
      >
        <label className="field">
          {t('auth.email')}
          <input type="email" autoComplete="username" autoFocus required maxLength={320} value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field">
          {t('auth.password')}
          <input type="password" autoComplete="current-password" required maxLength={256} value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <FormError text={error} />
        <div className="row end">
          <Button variant="primary" type="submit" disabled={busy || !email.trim() || !password}>
            {busy ? t('auth.signingIn') : t('auth.signIn')}
          </Button>
        </div>
        <p className="muted small">{t('auth.forgot')}</p>
      </form>
    </AuthCard>
  );
}

/** A new password, typed twice; shared by setup and invites. */
export function NewPassword({ password, repeat, onPassword, onRepeat }: { password: string; repeat: string; onPassword: (s: string) => void; onRepeat: (s: string) => void }) {
  return (
    <>
      <label className="field">
        {t('auth.password')}
        <input
          type="password"
          autoComplete="new-password"
          required
          minLength={10}
          maxLength={256}
          aria-describedby="new-password-hint"
          value={password}
          onChange={(e) => onPassword(e.target.value)}
        />
      </label>
      <p id="new-password-hint" className="small muted hint">
        {t('auth.passwordHint')}
      </p>
      <label className="field">
        {t('auth.passwordRepeat')}
        <input type="password" autoComplete="new-password" required maxLength={256} value={repeat} onChange={(e) => onRepeat(e.target.value)} />
      </label>
    </>
  );
}

/** Why a new password cannot be used yet, or null. */
export function newPasswordProblem(password: string, repeat: string): string | null {
  if (password.length < 10) return t('error.password-short');
  if (password !== repeat) return t('error.password-mismatch');
  return null;
}
