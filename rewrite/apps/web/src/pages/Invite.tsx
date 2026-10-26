import { useEffect, useState } from 'react';
import type { InviteState, SignInResponse } from '@gp/core';
import { api } from '../auth/api.ts';
import { errorText } from '../auth/errors.ts';
import { deviceName } from '../auth/session.ts';
import { t } from '../i18n.ts';
import { Button } from '../ui/Button.tsx';
import { AuthCard, FormError } from './AuthCard.tsx';
import { newPasswordProblem, NewPassword } from './SignIn.tsx';

/** `#/invite/{token}` (spec 01): the invited person chooses a password and is signed in. */
export function Invite({ token, onSignedIn }: { token: string; onSignedIn: (r: SignInResponse) => void }) {
  const [state, setState] = useState<InviteState | 'offline' | null>(null);
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<InviteState>('POST', '/auth/invites/lookup', { token }).then(
      (r) => setState(r.error ? { state: 'invalid' } : r.body),
      () => setState('offline'),
    );
  }, [token]);

  if (state === null) return <AuthCard title={t('auth.loading')}>{null}</AuthCard>;
  if (state === 'offline') return <AuthCard title={t('auth.signIn')}>{<p>{t('auth.offline')}</p>}</AuthCard>;
  if (state.state === 'expired') return <AuthCard title={t('error.invite-expired')}>{null}</AuthCard>;
  if (state.state === 'invalid') {
    return (
      <AuthCard title={t('error.invite-invalid')}>
        <p>{t('invite.invalidHelp')}</p>
      </AuthCard>
    );
  }
  return (
    <AuthCard title={t('invite.welcome', { name: state.name })}>
      <p>{t('invite.org', { org: state.orgName })}</p>
      <p className="muted">{t('invite.choosePassword')}</p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const problem = newPasswordProblem(password, repeat);
          setError(problem);
          if (problem || busy) return;
          setBusy(true);
          try {
            const r = await api<SignInResponse>('POST', '/auth/invites/accept', { token, password, deviceName: deviceName() });
            if (!r.error) return onSignedIn(r.body);
            setError(errorText(r));
          } catch {
            setError(t('auth.offline'));
          }
          setBusy(false);
        }}
      >
        {state.email && (
          <label className="field">
            {t('auth.email')}
            <input type="email" autoComplete="username" readOnly value={state.email} />
          </label>
        )}
        <NewPassword password={password} repeat={repeat} onPassword={setPassword} onRepeat={setRepeat} />
        <FormError text={error} />
        <div className="row end">
          <Button variant="primary" type="submit" disabled={busy}>
            {t('invite.submit')}
          </Button>
        </div>
      </form>
    </AuthCard>
  );
}
