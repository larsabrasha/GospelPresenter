import { useEffect, useState } from 'react';
import type { SetupResponse, SignInResponse } from '@gp/core';
import { api } from '../auth/api.ts';
import { errorText } from '../auth/errors.ts';
import { t } from '../i18n.ts';
import { Button } from '../ui/Button.tsx';
import { AuthCard, FormError } from './AuthCard.tsx';
import { GoogleSignIn } from './SignIn.tsx';

/**
 * First run (spec 01 `/setup`, D19): the organisation and its SuperAdmin,
 * who then signs in with Google through the invite setup answers with
 * (spec 01: setup goes on to `/invite/{token}`). Needs the setup token,
 * which the desktop host hands its own window and a self-hosted server
 * prints in its log.
 */
export function Setup({ onSignedIn }: { onSignedIn: (r: SignInResponse) => void }) {
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
      <GoogleSignIn title={t('setup.title')} invite={invite} autoStart onSignedIn={onSignedIn}>
        <p>{t('setup.google')}</p>
      </GoogleSignIn>
    );
  }
  return (
    <AuthCard title={t('setup.title')}>
      <p>{t('setup.text')}</p>
      <p>{t('setup.google')}</p>
      <form
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
            const r = await api<SetupResponse>('POST', '/auth/setup', { setupToken: hostToken ?? setupToken.trim(), name, orgName });
            if (!r.error) return setInvite(r.body.inviteToken);
            setErrors({ form: errorText(r) });
          } catch {
            setErrors({ form: t('auth.offline') });
          }
          setBusy(false);
        }}
      >
        <label className="field">
          {t('setup.name')}
          <input autoFocus maxLength={200} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        {errors.name && <p className="danger hint">{errors.name}</p>}
        <label className="field">
          {t('setup.orgName')}
          <input maxLength={200} value={orgName} onChange={(e) => setOrgName(e.target.value)} />
        </label>
        {errors.org && <p className="danger hint">{errors.org}</p>}
        {!hostToken && (
          <>
            <label className="field">
              {t('setup.token')}
              <input autoComplete="off" maxLength={200} aria-describedby="setup-token-hint" value={setupToken} onChange={(e) => setSetupToken(e.target.value)} />
            </label>
            <p id="setup-token-hint" className="small muted hint">
              {t('setup.tokenHint')}
            </p>
          </>
        )}
        <FormError text={errors.form ?? null} />
        <div className="row end">
          <Button variant="primary" type="submit" disabled={busy}>
            {t('setup.submit')}
          </Button>
        </div>
      </form>
    </AuthCard>
  );
}
