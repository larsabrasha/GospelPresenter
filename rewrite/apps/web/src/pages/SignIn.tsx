import { useEffect, useRef, type ReactNode } from 'react';
import type { AuthState, SignInResponse } from '@gp/core';
import { useDesktopSignIn } from '../auth/google.ts';
import { t } from '../i18n.ts';
import { Button } from '../ui/Button.tsx';
import { AuthCard, FormError } from './AuthCard.tsx';

/** What the server offers when it could not be asked: Google, as before passkeys. */
const FALLBACK: Pick<AuthState, 'google' | 'passkeys'> = { google: true, passkeys: false };

/**
 * The sign-in buttons, a passkey and Google, as far as the server offers
 * them, and in the desktop app the wait for the system browser. With
 * `invite`, the passkey made (or the Google account chosen) becomes the
 * invited user's. There are no passwords, and no self-registration (AUTH-R4).
 */
export function SignInChoices({
  title,
  children,
  invite,
  methods,
  initialError = null,
  autoStart = false,
  onSignedIn,
}: {
  title: string;
  children?: ReactNode;
  invite?: string;
  methods: Pick<AuthState, 'google' | 'passkeys'> | null;
  initialError?: string | null;
  /** Start Google at once when it is the only way: setup has already asked the person to go on. */
  autoStart?: boolean;
  onSignedIn: (r: SignInResponse) => void;
}) {
  const s = useDesktopSignIn(onSignedIn);
  const { google, passkeys } = methods ?? FALLBACK;
  const started = useRef(false);
  useEffect(() => {
    if (!autoStart || started.current || passkeys || !google) return;
    started.current = true;
    void s.start(invite);
  }, [autoStart, invite, s, google, passkeys]);

  if (s.waiting) {
    return (
      <AuthCard title={t('auth.waiting')}>
        <p>{t('auth.waitingText')}</p>
        <div className="row end">
          <Button onClick={s.cancel}>{t('auth.cancel')}</Button>
        </div>
      </AuthCard>
    );
  }
  return (
    <AuthCard title={title}>
      {children}
      <FormError text={s.error ?? initialError} />
      <div className="row end">
        {google && (
          <Button variant={passkeys ? 'normal' : 'primary'} onClick={() => void s.start(invite)}>
            {t('auth.google')}
          </Button>
        )}
        {passkeys && (
          <Button variant="primary" onClick={() => void s.passkey(invite)}>
            {invite ? t('passkey.create') : t('passkey.signIn')}
          </Button>
        )}
      </div>
      {!google && !passkeys && <p className="danger">{t('error.google-disabled')}</p>}
    </AuthCard>
  );
}

/** The text that says how to sign in, for what the server offers. */
export function methodsText(methods: Pick<AuthState, 'google' | 'passkeys'> | null, kind: 'signIn' | 'invite' | 'setup'): string {
  const { google, passkeys } = methods ?? FALLBACK;
  const which = google && passkeys ? 'both' : passkeys ? 'passkey' : 'google';
  return t(`${kind}.methods.${which}`);
}

/** "Logga in": with a passkey or Google. */
export function SignIn({ error, methods, onSignedIn }: { error: string | null; methods: AuthState | null; onSignedIn: (r: SignInResponse) => void }) {
  return (
    <SignInChoices title={t('auth.signIn')} methods={methods} initialError={error} onSignedIn={onSignedIn}>
      <p>{methodsText(methods, 'signIn')}</p>
      {window.gpDesktop && <p className="muted small">{t('auth.onceOnline')}</p>}
    </SignInChoices>
  );
}
