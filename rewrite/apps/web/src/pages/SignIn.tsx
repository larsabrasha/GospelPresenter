import { useEffect, useRef, type ReactNode } from 'react';
import type { SignInResponse } from '@gp/core';
import { useDesktopSignIn } from '../auth/google.ts';
import { t } from '../i18n.ts';
import { Button } from '../ui/Button.tsx';
import { AuthCard, FormError } from './AuthCard.tsx';

/**
 * The Google button, and in the desktop app the wait for the system browser.
 * With `invite`, the account chosen at Google is linked to the invited user.
 * There are no passwords, and no self-registration (AUTH-R4).
 */
export function GoogleSignIn({
  title,
  children,
  invite,
  initialError = null,
  autoStart = false,
  onSignedIn,
}: {
  title: string;
  children?: ReactNode;
  invite?: string;
  initialError?: string | null;
  /** Start at once: setup has already asked the person to go on. */
  autoStart?: boolean;
  onSignedIn: (r: SignInResponse) => void;
}) {
  const s = useDesktopSignIn(onSignedIn);
  const started = useRef(false);
  useEffect(() => {
    if (!autoStart || started.current) return;
    started.current = true;
    void s.start(invite);
  }, [autoStart, invite, s]);

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
        <Button variant="primary" onClick={() => void s.start(invite)}>
          {t('auth.google')}
        </Button>
      </div>
    </AuthCard>
  );
}

/** "Logga in": with Google only. */
export function SignIn({ error, onSignedIn }: { error: string | null; onSignedIn: (r: SignInResponse) => void }) {
  return (
    <GoogleSignIn title={t('auth.signIn')} initialError={error} onSignedIn={onSignedIn}>
      <p>{t('auth.googleText')}</p>
      {window.gpDesktop && <p className="muted small">{t('auth.onceOnline')}</p>}
    </GoogleSignIn>
  );
}
