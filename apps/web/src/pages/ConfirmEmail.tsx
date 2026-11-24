import { useEffect, useState } from 'react';
import { api } from '../auth/api.ts';
import { errorText } from '../auth/errors.ts';
import { t } from '../i18n.ts';
import { AppButton } from '../ui/AppButton.tsx';
import { AUTH_TEXT, AuthCard, FormError } from './AuthCard.tsx';

/**
 * `/confirm-email#{token}` (docs/accounts-and-roles.md): the link that reached an address. Opening it makes the
 * address its account's, confirmed; it needs no session, so it works on whatever device the mail was read on.
 */
export function ConfirmEmail({ token }: { token: string }) {
  const [state, setState] = useState<'confirming' | 'done' | string>('confirming');
  useEffect(() => {
    api('POST', '/api/auth/email/confirm', { token }).then(
      (r) => setState(r.error ? (r.error === 'invite-invalid' ? t('confirmEmail.invalid') : errorText(r)) : 'done'),
      () => setState(t('auth.offline')),
    );
  }, [token]);
  if (state === 'confirming') return <AuthCard title={t('confirmEmail.confirming')} titleClassName="loading-line text-base/6 font-normal text-stone-400" centered />;
  return (
    <AuthCard title={state === 'done' ? t('confirmEmail.done') : t('confirmEmail.title')} centered>
      {state === 'done' ? <p className={AUTH_TEXT}>{t('confirmEmail.doneText')}</p> : <FormError text={state} center />}
      <div className="flex justify-center">
        <AppButton href="/">{t('confirmEmail.open')}</AppButton>
      </div>
    </AuthCard>
  );
}
