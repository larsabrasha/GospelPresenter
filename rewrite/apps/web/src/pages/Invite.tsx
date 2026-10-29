import { useEffect, useState, type ReactNode } from 'react';
import type { AuthState, InviteState, SignInResponse } from '@gp/core';
import { api } from '../auth/api.ts';
import { t } from '../i18n.ts';
import { AUTH_TEXT, AuthCard } from './AuthCard.tsx';
import { SignInChoices } from './SignIn.tsx';

/** A translation with `{value}` in it, the value in bold (LocalizedEmphasis.razor). */
function Emphasis({ text, value }: { text: string; value: string }) {
  const [before, after = ''] = text.split('{value}');
  return (
    <>
      {before}
      <strong>{value}</strong>
      {after}
    </>
  );
}

/** An envelope with a clock struck through (InvitePage.razor). */
function ExpiredPicture() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 200 160" className="w-40 h-auto mb-4 text-neutral-300 dark:text-neutral-600" aria-hidden="true">
      <rect x="30" y="45" width="140" height="90" rx="8" stroke="currentColor" strokeWidth="2" className="fill-neutral-100 dark:fill-neutral-800" />
      <path d="M30 53 L100 95 L170 53" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" opacity="0.5" />
      <circle cx="150" cy="45" r="22" stroke="currentColor" strokeWidth="2" className="fill-neutral-100 dark:fill-neutral-800" />
      <line x1="150" y1="45" x2="150" y2="33" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="150" y1="45" x2="160" y2="48" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="150" cy="45" r="2" fill="currentColor" />
      <line x1="138" y1="33" x2="162" y2="57" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" opacity="0.6" />
      <line x1="162" y1="33" x2="138" y2="57" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" opacity="0.6" />
    </svg>
  );
}

/** An envelope with a cross (InvitePage.razor). */
function InvalidPicture() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 200 160" className="w-40 h-auto mb-4 text-neutral-300 dark:text-neutral-600" aria-hidden="true">
      <rect x="30" y="35" width="140" height="95" rx="8" stroke="currentColor" strokeWidth="2" className="fill-neutral-100 dark:fill-neutral-800" />
      <path d="M30 43 L100 88 L170 43" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" opacity="0.5" />
      <line x1="60" y1="100" x2="120" y2="100" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.25" />
      <line x1="60" y1="112" x2="105" y2="112" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.2" />
      <circle cx="152" cy="112" r="18" stroke="currentColor" strokeWidth="2" className="fill-neutral-100 dark:fill-neutral-800" />
      <line x1="144" y1="104" x2="160" y2="120" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="160" y1="104" x2="144" y2="120" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

/** An invite that cannot be used: a picture and the reason, without the logo (InvitePage.razor). */
function Unusable({ picture, title, titleClassName, text }: { picture: ReactNode; title: string; titleClassName: string; text?: string }) {
  return (
    <main className="flex-1 flex flex-col items-center">
      <div className="flex flex-col items-center text-center px-4 pt-20 select-none">
        {picture}
        <h1 className={`text-sm font-normal leading-relaxed ${titleClassName}`}>{title}</h1>
        {text && <p className="text-sm text-neutral-400 dark:text-neutral-500 mt-2 leading-relaxed">{text}</p>}
      </div>
    </main>
  );
}

/**
 * `/invite#{token}` (spec 01): the invited person makes a passkey or signs
 * in with Google, and that becomes their way in. More can be added later
 * under Inloggningsmetoder.
 */
export function Invite({ token, methods, onSignedIn }: { token: string; methods: AuthState | null; onSignedIn: (r: SignInResponse) => void }) {
  const [state, setState] = useState<InviteState | 'offline' | null>(null);

  useEffect(() => {
    api<InviteState>('POST', '/api/auth/invites/lookup', { token }).then(
      (r) => setState(r.error ? { state: 'invalid' } : r.body),
      () => setState('offline'),
    );
  }, [token]);

  if (state === null) return <AuthCard title={t('auth.loading')} titleClassName="text-base/6 font-normal text-neutral-400" />;
  if (state === 'offline')
    return (
      <AuthCard title={t('auth.signIn')}>
        <p className={AUTH_TEXT}>{t('auth.offline')}</p>
      </AuthCard>
    );
  if (state.state === 'expired') return <Unusable picture={<ExpiredPicture />} title={t('error.invite-expired')} titleClassName="text-neutral-500 dark:text-neutral-400" />;
  if (state.state === 'invalid') return <Unusable picture={<InvalidPicture />} title={t('error.invite-invalid')} titleClassName="text-red-400" text={t('invite.invalidHelp')} />;
  return (
    <SignInChoices
      title={<Emphasis text={t('invite.welcome', { name: '{value}' })} value={state.name} />}
      titleClassName="text-lg/7 font-normal dark:text-neutral-100 text-center px-4"
      invite={token}
      methods={methods}
      firstOnly
      onSignedIn={onSignedIn}
    >
      {state.orgName.trim() && (
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400 text-center" data-testid="invite-org">
          <Emphasis text={t('invite.org', { org: '{value}' })} value={state.orgName} />
        </p>
      )}
      <p className="mt-4 mb-2 text-sm text-neutral-500 dark:text-neutral-400 text-center">{t('invite.choose')}</p>
    </SignInChoices>
  );
}
