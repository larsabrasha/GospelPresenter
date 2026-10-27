import { useEffect, useState } from 'react';
import type { AuthState, SetupResponse, SignInResponse } from '@gp/core';
import { api } from '../auth/api.ts';
import { errorText } from '../auth/errors.ts';
import { t } from '../i18n.ts';
import { AppButton } from '../ui/AppButton.tsx';
import { FloatingInput } from '../ui/Floating.tsx';
import { AUTH_SUBMIT, AUTH_TEXT, AuthCard, FormError } from './AuthCard.tsx';
import { methodsText, SignInChoices } from './SignIn.tsx';

/** A field's message, as Setup.razor's. */
const ERROR = '-mt-2 text-sm text-red-500 dark:text-red-400';

/**
 * First run (spec 01 `/setup`, D19): the organisation and its SuperAdmin,
 * who then makes a passkey or signs in with Google through the invite setup
 * answers with (spec 01: setup goes on to `/invite/{token}`). Needs the setup token,
 * which the desktop host hands its own window and a self-hosted server
 * prints in its log.
 */
export function Setup({ methods, onSignedIn }: { methods: AuthState | null; onSignedIn: (r: SignInResponse) => void }) {
  const [hostToken, setHostToken] = useState<string | null>(null);
  const [setupToken, setSetupToken] = useState('');
  const [name, setName] = useState('');
  const [orgName, setOrgName] = useState('');
  const [errors, setErrors] = useState<{ name?: string; org?: string; form?: string | null }>({});
  const [busy, setBusy] = useState(false);
  const [invite, setInvite] = useState<string | null>(null);

  useEffect(() => {
    void window.gpDesktop?.setupToken().then(setHostToken);
  }, []);

  if (invite) {
    return (
      <SignInChoices title={t('setup.title')} invite={invite} methods={methods} autoStart onSignedIn={onSignedIn}>
        <p className={AUTH_TEXT}>{methodsText(methods, 'setup')}</p>
      </SignInChoices>
    );
  }
  return (
    <AuthCard title={t('setup.title')}>
      <p className={AUTH_TEXT}>{t('setup.text')}</p>
      <p className={`${AUTH_TEXT} mb-2`}>{methodsText(methods, 'setup')}</p>
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          // AUTH-A2: blank (whitespace only) names are refused here, before anything is sent.
          const next = {
            name: name.trim() ? undefined : t('setup.nameRequired'),
            org: orgName.trim() ? undefined : t('setup.orgRequired'),
          };
          setErrors(next);
          if (next.name || next.org) return;
          setBusy(true);
          try {
            const r = await api<SetupResponse>('POST', '/api/auth/setup', { setupToken: hostToken ?? setupToken.trim(), name, orgName });
            if (!r.error) return setInvite(r.body.inviteToken);
            setErrors({ form: errorText(r) });
          } catch {
            setErrors({ form: t('auth.offline') });
          }
          setBusy(false);
        }}
      >
        <FloatingInput id="setup-name" label={t('setup.name')} autoFocus maxLength={200} value={name} onChange={(e) => setName(e.target.value)} />
        {errors.name && <p className={ERROR}>{errors.name}</p>}
        <FloatingInput id="setup-organization" label={t('setup.orgName')} maxLength={200} value={orgName} onChange={(e) => setOrgName(e.target.value)} />
        {errors.org && <p className={ERROR}>{errors.org}</p>}
        {!hostToken && (
          <div>
            <FloatingInput
              id="setup-token"
              label={t('setup.token')}
              type="password"
              autoComplete="off"
              maxLength={200}
              aria-describedby="setup-token-hint"
              value={setupToken}
              onChange={(e) => setSetupToken(e.target.value)}
            />
            <p id="setup-token-hint" className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
              {t('setup.tokenHint')}
            </p>
          </div>
        )}
        <FormError text={errors.form ?? null} />
        <AppButton variant="plain" type="submit" disabled={busy} className={AUTH_SUBMIT}>
          {t('setup.submit')}
        </AppButton>
      </form>
    </AuthCard>
  );
}
