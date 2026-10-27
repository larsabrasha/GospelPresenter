import { useEffect, useRef, type ReactNode } from 'react';
import type { AuthState, SignInResponse } from '@gp/core';
import { useDesktopSignIn } from '../auth/google.ts';
import { t } from '../i18n.ts';
import { AppButton } from '../ui/AppButton.tsx';
import { GoogleIcon } from '../ui/icons.tsx';
import { AUTH_TEXT, AuthCard, FormError } from './AuthCard.tsx';

/** The sign-in buttons of SignIn.razor: Google white with its G, any other way sky blue. */
const GOOGLE = 'flex items-center justify-center gap-2 w-64 px-6 py-3 rounded-full bg-white text-neutral-700 text-lg cursor-pointer hover:bg-neutral-100 border border-neutral-300';
const OTHER = 'flex items-center justify-center gap-2 w-64 px-6 py-3 rounded-full bg-sky-500 text-white text-lg cursor-pointer hover:bg-sky-600';

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
  titleClassName,
  children,
  invite,
  methods,
  initialError = null,
  autoStart = false,
  centered,
  onSignedIn,
}: {
  title: ReactNode;
  titleClassName?: string;
  children?: ReactNode;
  invite?: string;
  methods: Pick<AuthState, 'google' | 'passkeys'> | null;
  initialError?: string | null;
  /** Start Google at once when it is the only way: setup has already asked the person to go on. */
  autoStart?: boolean;
  /** The sign-in page's own look (AuthCard). */
  centered?: boolean;
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
      <AuthCard title={t('auth.waiting')} centered={centered}>
        <p className={AUTH_TEXT}>{t('auth.waitingText')}</p>
        <div className="flex justify-center">
          <AppButton variant="neutral" onClick={s.cancel}>
            {t('auth.cancel')}
          </AppButton>
        </div>
      </AuthCard>
    );
  }
  return (
    <AuthCard title={title} titleClassName={titleClassName} centered={centered}>
      {children}
      <FormError text={s.error ?? initialError} center />
      <div className="flex flex-col items-center gap-3 pt-2">
        {google && (
          <AppButton variant="plain" className={GOOGLE} onClick={() => void s.start(invite)}>
            <GoogleIcon className="w-5 h-5" />
            {t('auth.google')}
          </AppButton>
        )}
        {passkeys && (
          <AppButton variant="plain" className={OTHER} onClick={() => void s.passkey(invite)}>
            {invite ? t('passkey.create') : t('passkey.signIn')}
          </AppButton>
        )}
      </div>
      {!google && !passkeys && <p className="text-sm text-red-500 dark:text-red-400 text-center">{t('error.google-disabled')}</p>}
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
    <SignInChoices title={t('auth.signIn')} methods={methods} initialError={error} centered onSignedIn={onSignedIn}>
      <p className={AUTH_TEXT}>{methodsText(methods, 'signIn')}</p>
      {window.gpDesktop && <p className="text-xs text-neutral-400 dark:text-neutral-500 leading-relaxed text-center">{t('auth.onceOnline')}</p>}
    </SignInChoices>
  );
}
