import { useState, type FormEvent, type ReactNode } from 'react';
import { ACCOUNT_LIMITS, type SignInResponse } from '@gp/core';
import { api } from '../auth/api.ts';
import { errorText } from '../auth/errors.ts';
import { deviceName } from '../auth/session.ts';
import { t } from '../i18n.ts';
import { AppButton } from '../ui/AppButton.tsx';
import { FloatingInput } from '../ui/Floating.tsx';
import { SMALL_ACTION } from '../ui/Group.tsx';
import { AUTH_SUBMIT, AUTH_TEXT, AuthCard, FormError } from './AuthCard.tsx';

/** What a refusal of the desktop app's `connectServer` says. */
const refusal = (r: 'invalid' | 'unreachable' | 'refused') => t(r === 'unreachable' ? 'server.unreachable' : 'desktop.invalidServer');

/** A shaped button as wide as the sign-in's, quieter than it (Lars, 2026-11-25: buttons with a shape). */
const SECOND = 'w-64 px-6 py-3 rounded-full bg-sky-500/12 text-sky-600 dark:text-sky-300 text-lg cursor-pointer hover:bg-sky-500/20 disabled:opacity-50 disabled:cursor-default';

/**
 * The desktop app's start on its own computer (D8; Lars, 2026-11-26), whenever its window is not signed in: an account
 * on our cloud, or another server by its address, the app then a client of it; or the computer used without an
 * account, everything kept on it and the church's phones and screens connecting to it on the network, even with no
 * internet. Without an account there is no sign-in: the first time asks the person's and the church's names, after
 * that Fortsätt; "Logga in som någon annan här" is the computer's own sign-in (`onSignInHere`), for a church whose
 * people share it. `setUp`: the computer has been set up. First what was chosen before: without an account once set up.
 */
export function DesktopStart({ setUp, onSignedIn, onSignInHere }: { setUp: boolean; onSignedIn: (r: SignInResponse) => void; onSignInHere: () => void }) {
  const desktop = window.gpDesktop!;
  const [other, setOther] = useState(false);
  const [address, setAddress] = useState('');
  const [local, setLocal] = useState(false);
  const [name, setName] = useState('');
  const [orgName, setOrgName] = useState('');
  const [busy, setBusy] = useState<'cloud' | 'other' | 'local' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const connect = async (typed: string, which: 'cloud' | 'other') => {
    setBusy(which);
    setError(null);
    try {
      const r = await desktop.connectServer!(typed);
      // On 'ok' the window is already on its way to the server.
      if (r !== 'ok') setError(refusal(r));
    } catch {
      setError(t('auth.offline'));
    }
    setBusy(null);
  };
  /** In without an account: the first time with the names, which set the computer up so. */
  const here = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!setUp) {
      const missing = !name.trim() ? t('setup.nameRequired') : !orgName.trim() ? t('setup.orgRequired') : null;
      setError(missing);
      if (missing) return;
    }
    setBusy('local');
    try {
      const r = await api<SignInResponse>('POST', '/api/auth/host-window', setUp ? { deviceName: deviceName() } : { deviceName: deviceName(), name, orgName });
      if (!r.error) return onSignedIn(r.body);
      setError(errorText(r));
    } catch {
      setError(t('auth.offline'));
    }
    setBusy(null);
  };

  const account: ReactNode = (
    <section className="flex flex-col items-center gap-3" aria-label={t('desktop.signInCloud')}>
      <p className={AUTH_TEXT}>{t('desktop.connectText')}</p>
      <AppButton variant="plain" className={setUp ? SECOND : `${AUTH_SUBMIT} w-64`} loading={busy === 'cloud'} disabled={!!busy} onClick={() => void connect(desktop.cloud!, 'cloud')}>
        {t('desktop.signInCloud')}
      </AppButton>
      <p className="text-xs text-stone-400 dark:text-stone-500">{new URL(desktop.cloud!).host}</p>
      {other ? (
        <form className="w-64 space-y-3" onSubmit={(e) => (e.preventDefault(), address.trim() && void connect(address, 'other'))}>
          <p className={AUTH_TEXT}>{t('desktop.otherText')}</p>
          <FloatingInput label={t('server.address')} type="url" inputMode="url" autoCapitalize="none" autoCorrect="off" autoFocus maxChars={200} value={address} onChange={(e) => setAddress(e.target.value)} />
          <div className="flex justify-center">
            <AppButton type="submit" disabled={!address.trim() || !!busy} loading={busy === 'other'}>
              {t('server.use')}
            </AppButton>
          </div>
        </form>
      ) : (
        <AppButton variant="plain" className={SMALL_ACTION} disabled={!!busy} onClick={() => setOther(true)}>
          {t('desktop.otherServer')}
        </AppButton>
      )}
    </section>
  );

  const withoutAccount: ReactNode = (
    <section className="flex flex-col items-center gap-3" aria-label={t('desktop.withoutAccount')}>
      <p className={AUTH_TEXT}>{t('desktop.withoutAccountText')}</p>
      {setUp ? (
        <>
          <AppButton variant="plain" className={`${AUTH_SUBMIT} w-64`} loading={busy === 'local'} disabled={!!busy} onClick={() => void here()}>
            {t('desktop.continueHere')}
          </AppButton>
          <AppButton variant="plain" className={SMALL_ACTION} disabled={!!busy} onClick={onSignInHere}>
            {t('desktop.signInHere')}
          </AppButton>
        </>
      ) : local ? (
        <form className="w-64 flex flex-col gap-4" onSubmit={(e) => void here(e)}>
          <FloatingInput id="setup-name" label={t('setup.name')} autoFocus maxChars={ACCOUNT_LIMITS.personName} value={name} onChange={(e) => setName(e.target.value)} />
          <FloatingInput id="setup-organization" label={t('setup.orgName')} maxChars={ACCOUNT_LIMITS.orgName} value={orgName} onChange={(e) => setOrgName(e.target.value)} />
          <AppButton variant="plain" type="submit" disabled={!!busy} loading={busy === 'local'} className={AUTH_SUBMIT}>
            {t('setup.submit')}
          </AppButton>
        </form>
      ) : (
        <AppButton variant="plain" className={SECOND} disabled={!!busy} onClick={() => setLocal(true)}>
          {t('desktop.withoutAccount')}
        </AppButton>
      )}
    </section>
  );

  return (
    <AuthCard title={t(setUp ? 'desktop.welcomeBack' : 'setup.title')} centered>
      {setUp ? withoutAccount : account}
      <p className="text-center text-xs text-stone-400 dark:text-stone-500 py-2" aria-hidden>
        {t('desktop.or')}
      </p>
      {setUp ? account : withoutAccount}
      <FormError text={error} center />
    </AuthCard>
  );
}

/** "Byt server" on a server's sign-in and pairing pages in the desktop app: back to this computer's own start. */
export function LeaveServer() {
  const desktop = window.gpDesktop;
  if (!desktop || desktop.isHost || !desktop.leaveServer || desktop.serverFixed) return null;
  return (
    <div className="pt-6 flex justify-center">
      <AppButton variant="plain" className={SMALL_ACTION} onClick={() => void desktop.leaveServer!()}>
        {t('desktop.leaveServer')}
      </AppButton>
    </div>
  );
}
