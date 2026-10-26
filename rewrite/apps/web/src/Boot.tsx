import { useEffect, useState } from 'react';
import type { PairStatus, SignInResponse } from '@gp/core';
import { api } from './auth/api.ts';
import { saveDeviceToken, saveSession, storedSession } from './auth/session.ts';
import { t } from './i18n.ts';
import { AuthCard } from './pages/AuthCard.tsx';
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

type Screen = 'loading' | 'offline' | 'pair' | 'setup' | 'signin' | 'invite';

/** Which screen comes first: pairing, then an invite, setup or sign-in. */
async function firstScreen(invite: string | null): Promise<Screen> {
  try {
    const pair = await api<PairStatus>('GET', '/pair/status');
    if (!pair.error && pair.body.required && !pair.body.paired) {
      saveDeviceToken(null); // a token the host no longer knows
      return 'pair';
    }
    if (invite) return 'invite';
    // Signed in and only here to pair again: back to the app.
    if (storedSession()) {
      enterApp();
      return 'loading';
    }
    const state = await api<{ setupRequired: boolean }>('GET', '/auth/state');
    return state.body?.setupRequired ? 'setup' : 'signin';
  } catch {
    return 'offline';
  }
}

/**
 * Everything before the app: pairing with a desktop host first (nothing else
 * answers an unpaired device), then an invite, first-run setup or sign-in.
 */
export function Boot({ invite }: { invite: string | null }) {
  const [screen, setScreen] = useState<Screen>('loading');
  useEffect(() => {
    void firstScreen(invite).then(setScreen);
  }, [invite]);
  const decide = () => {
    setScreen('loading');
    void firstScreen(invite).then(setScreen);
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
      return <Pair onPaired={decide} />;
    case 'invite':
      return <Invite token={invite!} onSignedIn={signedIn} />;
    case 'setup':
      return <Setup onSignedIn={signedIn} />;
    case 'signin':
      return <SignIn onSignedIn={signedIn} />;
  }
}
