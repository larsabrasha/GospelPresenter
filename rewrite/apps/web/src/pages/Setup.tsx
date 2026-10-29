import { useEffect, useState } from 'react';
import type { AuthState, SetupResponse, SignInResponse } from '@gp/core';
import { api } from '../auth/api.ts';
import { errorText } from '../auth/errors.ts';
import { t } from '../i18n.ts';
import { AppButton } from '../ui/AppButton.tsx';
import { FloatingInput } from '../ui/Floating.tsx';
import { AUTH_SUBMIT, AUTH_TEXT, AuthCard, FormError } from './AuthCard.tsx';
import { methodsText, SignInChoices } from './SignIn.tsx';

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
  /** One message at a time, the first thing missing or what the server said (Setup.razor). */
  const [error, setError] = useState<string | null>(null);
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
      <ul className="text-sm text-neutral-500 dark:text-neutral-400 leading-relaxed px-4 list-disc">
        <li>{t('setup.createOrgs')}</li>
        <li>{t('setup.manageUsers')}</li>
        <li>{t('setup.configure')}</li>
      </ul>
      <p className={`${AUTH_TEXT} mb-2`}>{methodsText(methods, 'setup')}</p>
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          // AUTH-A2: blank (whitespace only) fields are refused here, before anything is sent.
          const missing = !name.trim() ? t('setup.nameRequired') : !orgName.trim() ? t('setup.orgRequired') : !hostToken && !setupToken.trim() ? t('setup.tokenRequired') : null;
          setError(missing);
          if (missing) return;
          setBusy(true);
          try {
            const r = await api<SetupResponse>('POST', '/api/auth/setup', { setupToken: hostToken ?? setupToken.trim(), name, orgName });
            if (!r.error) return setInvite(r.body.inviteToken);
            setError(errorText(r));
          } catch {
            setError(t('auth.offline'));
          }
          setBusy(false);
        }}
      >
        <FloatingInput id="setup-name" label={t('setup.name')} autoFocus maxLength={200} value={name} onChange={(e) => setName(e.target.value)} />
        <FloatingInput id="setup-organization" label={t('setup.orgName')} maxLength={200} value={orgName} onChange={(e) => setOrgName(e.target.value)} />
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
        <FormError text={error} />
        <AppButton variant="plain" type="submit" disabled={busy} className={AUTH_SUBMIT}>
          {t('setup.submit')}
        </AppButton>
      </form>
    </AuthCard>
  );
}
