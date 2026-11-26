import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
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

/** The second choice under the main one, in text, as Apple's setup has it (Lars, 2026-11-26). */
const TEXT_CHOICE = 'px-3 py-1 rounded-full text-lg text-sky-600 dark:text-sky-400 cursor-pointer hover:bg-sky-500/10 disabled:opacity-50 disabled:cursor-default';

/**
 * The desktop app's start on its own computer (D8; Lars, 2026-11-26), whenever its window is not signed in: an account
 * on our cloud, or another server by its address, the app then a client of it; or the computer used without an
 * account, everything kept on it and the church's phones and screens connecting to it on the network, even with no
 * internet. Without an account there is no sign-in: the first time asks the person's and the church's names, after
 * that Fortsätt; "Logga in som någon annan här" is the computer's own sign-in (`onSignInHere`), for a church whose
 * people share it. `setUp`: the computer has been set up. Another server is offered where one signs in (LeaveServer),
 * here once set up, and when our cloud does not answer, as on a church's network with no internet.
 */
export function DesktopStart({ setUp, onSignedIn, onSignInHere }: { setUp: boolean; onSignedIn: (r: SignInResponse) => void; onSignInHere: () => void }) {
  const desktop = window.gpDesktop!;
  // A server's Annan server… opens at the address; the hash goes at once, so a reload is the start.
  const [view, setView] = useState<'start' | 'local' | 'other'>(() => (location.hash === OTHER_SERVER ? 'other' : 'start'));
  useEffect(() => {
    if (location.hash === OTHER_SERVER) history.replaceState(history.state, '', location.pathname + location.search);
  }, []);
  const [address, setAddress] = useState('');
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

  const back = () => (setView('start'), setError(null));
  const otherChoice = (
    <AppButton variant="plain" className={TEXT_CHOICE} disabled={!!busy} onClick={() => (setView('other'), setError(null))}>
      {t('desktop.otherServer')}
    </AppButton>
  );
  const cancel = (
    <AppButton variant="plain" className={TEXT_CHOICE} disabled={!!busy} onClick={back}>
      {t('common.cancel')}
    </AppButton>
  );

  // One main choice and one in text, nothing to read first (Lars, 2026-11-26: as Apple's setup does); what a choice
  // means is said on its own step. Another server is chosen where one signs in: a server's sign-in has Annan server…
  const body: ReactNode =
    view === 'other' ? (
      <form className="flex flex-col items-center gap-4" onSubmit={(e) => (e.preventDefault(), address.trim() && void connect(address, 'other'))}>
        <p className={AUTH_TEXT}>{t('desktop.otherText')}</p>
        <div className="w-64">
          <FloatingInput label={t('server.address')} type="url" inputMode="url" autoCapitalize="none" autoCorrect="off" autoFocus maxChars={200} value={address} onChange={(e) => setAddress(e.target.value)} />
        </div>
        <AppButton variant="plain" type="submit" className={`${AUTH_SUBMIT} w-64`} disabled={!address.trim() || !!busy} loading={busy === 'other'}>
          {t('server.use')}
        </AppButton>
        {cancel}
      </form>
    ) : view === 'local' ? (
      <form className="flex flex-col items-center gap-4" onSubmit={(e) => void here(e)}>
        <p className={AUTH_TEXT}>{t('desktop.withoutAccountText')}</p>
        <div className="w-64 flex flex-col gap-4">
          <FloatingInput id="setup-name" label={t('setup.name')} autoFocus maxChars={ACCOUNT_LIMITS.personName} value={name} onChange={(e) => setName(e.target.value)} />
          <FloatingInput id="setup-organization" label={t('setup.orgName')} maxChars={ACCOUNT_LIMITS.orgName} value={orgName} onChange={(e) => setOrgName(e.target.value)} />
        </div>
        <AppButton variant="plain" type="submit" disabled={!!busy} loading={busy === 'local'} className={`${AUTH_SUBMIT} w-64`}>
          {t('setup.submit')}
        </AppButton>
        {cancel}
      </form>
    ) : setUp ? (
      <div className="flex flex-col items-center gap-4">
        <AppButton variant="plain" className={`${AUTH_SUBMIT} w-64`} loading={busy === 'local'} disabled={!!busy} onClick={() => void here()}>
          {t('desktop.continueHere')}
        </AppButton>
        <AppButton variant="plain" className={TEXT_CHOICE} disabled={!!busy} onClick={onSignInHere}>
          {t('desktop.signInHere')}
        </AppButton>
        {otherChoice}
      </div>
    ) : (
      <div className="flex flex-col items-center gap-4">
        <AppButton variant="plain" className={`${AUTH_SUBMIT} w-64`} loading={busy === 'cloud'} disabled={!!busy} onClick={() => void connect(desktop.cloud!, 'cloud')}>
          {t('desktop.signInCloud')}
        </AppButton>
        <AppButton variant="plain" className={TEXT_CHOICE} disabled={!!busy} onClick={() => setView('local')}>
          {t('desktop.withoutAccount')}
        </AppButton>
        {error && otherChoice}
      </div>
    );

  const title = view === 'other' ? 'desktop.otherTitle' : view === 'local' ? 'desktop.withoutAccount' : setUp ? 'desktop.welcomeBack' : 'setup.title';
  return (
    <AuthCard title={t(title)} centered>
      {body}
      <FormError text={error} center />
    </AuthCard>
  );
}

/** Where a server's "Annan server…" sends this computer's start: straight to the address (LeaveServer). */
const OTHER_SERVER = '#other-server';

/**
 * "Annan server…" on a server's sign-in and pairing pages in the desktop app, our cloud's too: back to this
 * computer's start, at the address of another server, whose Avbryt is the start (Lars, 2026-11-26).
 */
export function LeaveServer() {
  const desktop = window.gpDesktop;
  if (!desktop || desktop.isHost || !desktop.leaveServer || desktop.serverFixed) return null;
  return (
    <div className="pt-6 flex justify-center">
      <AppButton variant="plain" className={SMALL_ACTION} onClick={() => void desktop.leaveServer!(OTHER_SERVER)}>
        {t('desktop.otherServer')}
      </AppButton>
    </div>
  );
}
