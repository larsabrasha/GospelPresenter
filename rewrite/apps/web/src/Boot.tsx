import { useEffect, useState } from 'react';
import type { AuthState, PairStatus, SignInResponse } from '@gp/core';
import { api } from './auth/api.ts';
import { errorText } from './auth/errors.ts';
import { deviceName, saveDeviceToken, saveSession, storedSession } from './auth/session.ts';
import { t } from './i18n.ts';
import { AuthCard, FormError } from './pages/AuthCard.tsx';
import { Invite } from './pages/Invite.tsx';
import { Pair } from './pages/Pair.tsx';
import { Setup } from './pages/Setup.tsx';
import { SignIn } from './pages/SignIn.tsx';
import { Button } from './ui/Button.tsx';

/** Set when the user asks to pair again from inside the app, so the next start goes through here. */
export const REPAIR_KEY = 'gp.repair';

/** Opens the app as the signed-in user: a fresh start, so the database worker opens their database (D3). */
export function enterApp() {
  sessionStorage.removeItem(REPAIR_KEY);
  history.replaceState(null, '', `${location.pathname}${location.search}#/songs`); // drops an invite token from the address
  location.reload();
}

function signedIn(r: SignInResponse) {
  saveSession(r);
  enterApp();
}

/** What Boot was opened for, from the address. */
export type BootFor = { invite: string } | { signedIn: true } | { error: string | null };

type Screen = 'loading' | 'offline' | 'pair' | 'repair' | 'setup' | 'signin' | 'invite' | 'handoff';

/** Which screen comes first: pairing, then an invite, a web sign-in coming back, setup or sign-in. */
async function firstScreen(boot: BootFor): Promise<Screen> {
  try {
    const pair = await api<PairStatus>('GET', '/pair/status');
    const host = !pair.error && pair.body.required;
    if (host && !pair.body.paired) {
      saveDeviceToken(null); // a token the host no longer knows
      return 'pair';
    }
    if ('invite' in boot) return 'invite';
    if ('signedIn' in boot) return 'handoff';
    // Signed in and only here to pair again: back to the app.
    if (storedSession()) {
      enterApp();
      return 'loading';
    }
    // A device paired with a desktop host signs in by pairing again; only the host's own window uses Google.
    if (host && !pair.body.host) return 'repair';
    const state = await api<AuthState>('GET', '/auth/state');
    return state.body?.setupRequired ? 'setup' : 'signin';
  } catch {
    return 'offline';
  }
}

/** Back from Google on the web: collects the session the server is holding for this browser, once. */
function Handoff() {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<SignInResponse>('POST', '/auth/google/finish', { deviceName: deviceName() }).then(
      (r) => (r.error ? setError(errorText(r)) : signedIn(r.body)),
      () => setError(t('auth.offline')),
    );
  }, []);
  return (
    <AuthCard title={error ? t('auth.signIn') : t('auth.signingIn')}>
      <FormError text={error} />
      {error && (
        <div className="row end">
          <Button onClick={() => location.assign(`${location.pathname}${location.search}#/signin`)}>{t('auth.retry')}</Button>
        </div>
      )}
    </AuthCard>
  );
}

/**
 * Everything before the app: pairing with a desktop host first (nothing else
 * answers an unpaired device), then an invite, first-run setup or sign-in.
 */
export function Boot({ boot }: { boot: BootFor }) {
  const [screen, setScreen] = useState<Screen>('loading');
  useEffect(() => {
    void firstScreen(boot).then(setScreen);
  }, [boot]);
  const decide = () => {
    setScreen('loading');
    void firstScreen(boot).then(setScreen);
  };

  switch (screen) {
    case 'loading':
      return <AuthCard title={t('auth.loading')}>{null}</AuthCard>;
    case 'offline':
      return (
        <AuthCard title={t('auth.signIn')}>
          <p>{t('auth.offline')}</p>
          <Button onClick={decide}>{t('auth.retry')}</Button>
        </AuthCard>
      );
    case 'pair':
    case 'repair':
      return <Pair paired={screen === 'repair'} onSignedIn={signedIn} />;
    case 'invite':
      return <Invite token={(boot as { invite: string }).invite} onSignedIn={signedIn} />;
    case 'handoff':
      return <Handoff />;
    case 'setup':
      return <Setup onSignedIn={signedIn} />;
    case 'signin': {
      const code = 'error' in boot ? boot.error : null;
      return <SignIn error={code ? errorText({ error: code, body: null }) : null} onSignedIn={signedIn} />;
    }
  }
}
