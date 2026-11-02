import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { AuthState, SignInResponse } from '@gp/core';
import { api } from '../auth/api.ts';
import { errorText } from '../auth/errors.ts';
import { useDesktopSignIn } from '../auth/google.ts';
import { language, t } from '../i18n.ts';
import { AppButton } from '../ui/AppButton.tsx';
import { FloatingInput } from '../ui/Floating.tsx';
import { GoogleIcon } from '../ui/icons.tsx';
import { appVersion } from '../version.ts';
import { AUTH_TEXT, AuthCard, FormError } from './AuthCard.tsx';

/** The sign-in buttons of SignIn.razor: Google white with its G, any other way sky blue. */
const GOOGLE = 'flex items-center justify-center gap-2 w-64 px-6 py-3 rounded-full bg-white text-stone-700 text-lg cursor-pointer hover:bg-stone-100 border border-stone-300';
const OTHER = 'flex items-center justify-center gap-2 w-64 px-6 py-3 rounded-full bg-sky-500 text-white text-lg cursor-pointer hover:bg-sky-600';

/** What the server offers when it could not be asked: Google, as before passkeys. */
const FALLBACK: Pick<AuthState, 'google' | 'passkeys'> = { google: true, passkeys: false };

/**
 * The sign-in buttons, a passkey and Google, as far as the server offers
 * them, and in the desktop app the wait for the system browser. With
 * `invite`, the passkey made (or the Google account chosen) becomes the
 * invited user's. There are no passwords, and no self-registration (AUTH-R4).
 * With `firstOnly`, as SignIn.razor: the first way, and the rest behind
 * "Fler alternativ". `footer` comes under the buttons.
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
  firstOnly,
  footer,
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
  firstOnly?: boolean;
  footer?: ReactNode;
  onSignedIn: (r: SignInResponse) => void;
}) {
  const s = useDesktopSignIn(onSignedIn);
  const [more, setMore] = useState(false);
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
  const ways = [
    google && {
      button: (
        <AppButton key="google" variant="plain" className={GOOGLE} onClick={() => void s.start(invite)}>
          <GoogleIcon className="w-5 h-5" />
          {t('auth.google')}
        </AppButton>
      ),
    },
    passkeys && {
      button: (
        <AppButton key="passkey" variant="plain" className={OTHER} onClick={() => void s.passkey(invite)}>
          {invite ? t('passkey.create') : t('passkey.signIn')}
        </AppButton>
      ),
    },
  ].filter((w) => !!w);
  return (
    <AuthCard title={title} titleClassName={titleClassName} centered={centered}>
      {children}
      <FormError text={s.error ?? initialError} center />
      <div className="flex flex-col items-center gap-3 pt-2">
        {(firstOnly && !more ? ways.slice(0, 1) : ways).map((w) => w.button)}
        {firstOnly && !more && ways.length > 1 && (
          <AppButton variant="plain" className="text-sm text-stone-400 hover:text-stone-600 dark:hover:text-stone-300 cursor-pointer" onClick={() => setMore(true)}>
            {t('auth.more')}
          </AppButton>
        )}
      </div>
      {!google && !passkeys && <p className="text-sm text-red-500 dark:text-red-400 text-center">{t('error.google-disabled')}</p>}
      {footer}
    </AuthCard>
  );
}

/** Setup's text that says how the superuser will sign in, for what the server offers. */
export function methodsText(methods: Pick<AuthState, 'google' | 'passkeys'> | null): string {
  const { google, passkeys } = methods ?? FALLBACK;
  return t(google && passkeys ? 'setup.methods.both' : passkeys ? 'setup.methods.passkey' : 'setup.methods.google');
}

/**
 * "Glömt hur du loggar in?" (decided on 2026-10-31; the current app has none): the person's e-mail address, to which
 * the server sends a new invite if a user has it. The answer is the same either way, so the page says "if".
 */
function Recover() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [state, setState] = useState<{ sending?: boolean; sent?: boolean; error?: string }>({});
  if (!open)
    return (
      <div className="flex justify-center pt-4">
        <AppButton variant="plain" className="text-sm text-stone-400 hover:text-stone-600 dark:hover:text-stone-300 cursor-pointer" onClick={() => setOpen(true)}>
          {t('recover.link')}
        </AppButton>
      </div>
    );
  if (state.sent) return <p className={`${AUTH_TEXT} pt-4 max-w-xs mx-auto`} role="status">{t('recover.sent')}</p>;
  const send = async (e: FormEvent) => {
    e.preventDefault();
    setState({ sending: true });
    try {
      const r = await api('POST', '/api/auth/recover', { email, language: language() });
      setState(r.error ? { error: r.error === 'invalid-request' ? t('recover.invalid') : errorText(r) } : { sent: true });
    } catch {
      setState({ error: t('auth.offline') });
    }
  };
  return (
    <form className="w-64 mx-auto pt-4 space-y-3" onSubmit={(e) => void send(e)}>
      <p className={AUTH_TEXT}>{t('recover.text')}</p>
      <FloatingInput label={t('recover.email')} type="email" autoFocus maxLength={320} value={email} onChange={(e) => setEmail(e.target.value)} />
      <FormError text={state.error ?? null} center />
      <div className="flex justify-center">
        <AppButton type="submit" disabled={!email.trim()} loading={state.sending}>
          {t('recover.send')}
        </AppButton>
      </div>
    </form>
  );
}

/**
 * "Logga in" (Login.razor): the logo, the first way to sign in with the rest
 * behind "Fler alternativ", and the app's version at the foot, also for when
 * what needs explaining is why one cannot get past this screen. The title is
 * there for screen readers only.
 */
export function SignIn({ error, methods, onSignedIn }: { error: string | null; methods: AuthState | null; onSignedIn: (r: SignInResponse) => void }) {
  const version = appVersion();
  return (
    <SignInChoices
      title={t('auth.signIn')}
      titleClassName="sr-only"
      methods={methods}
      initialError={error}
      centered
      firstOnly
      footer={
        <>
          {methods?.mail && <Recover />}
          {version && <p className="pt-16 text-xs text-stone-400 dark:text-stone-500 text-center">{version}</p>}
        </>
      }
      onSignedIn={onSignedIn}
    />
  );
}
