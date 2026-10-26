import { useEffect, useState } from 'react';
import type { AuthState, InviteState, SignInResponse } from '@gp/core';
import { api } from '../auth/api.ts';
import { t } from '../i18n.ts';
import { AuthCard } from './AuthCard.tsx';
import { methodsText, SignInChoices } from './SignIn.tsx';

/**
 * `#/invite/{token}` (spec 01): the invited person makes a passkey or signs
 * in with Google, and that becomes their way in. More can be added later
 * under Inloggningsmetoder.
 */
export function Invite({ token, methods, onSignedIn }: { token: string; methods: AuthState | null; onSignedIn: (r: SignInResponse) => void }) {
  const [state, setState] = useState<InviteState | 'offline' | null>(null);

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
    <SignInChoices title={t('invite.welcome', { name: state.name })} invite={token} methods={methods} onSignedIn={onSignedIn}>
      <p>{t('invite.org', { org: state.orgName })}</p>
      <p className="muted">{methodsText(methods, 'invite')}</p>
    </SignInChoices>
  );
}
