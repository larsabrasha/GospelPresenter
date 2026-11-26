import { useState, type FormEvent } from 'react';
import { t } from '../i18n.ts';
import { AppButton } from '../ui/AppButton.tsx';
import { FloatingInput } from '../ui/Floating.tsx';
import { SMALL_ACTION } from '../ui/Group.tsx';
import { AUTH_SUBMIT, AUTH_TEXT, AuthCard, FormError } from './AuthCard.tsx';

/** What a refusal of the desktop app's `connectServer` says. */
const refusal = (r: 'invalid' | 'unreachable' | 'refused') => t(r === 'unreachable' ? 'server.unreachable' : 'desktop.invalidServer');

/**
 * The desktop app's first start (D8; Lars, 2026-11-26): sign in with one's account on our cloud, first and largest,
 * so a church sees here what it has on the web; another server by its address (a church's own, or the computer that
 * is its host); or this computer alone, which then sets itself up as the host (`onLocal`, the name and the church).
 * A server is taken only once it answers, and the app then opens it, its sign-in page first.
 */
export function DesktopConnect({ onLocal }: { onLocal: () => void }) {
  const desktop = window.gpDesktop!;
  const [other, setOther] = useState(false);
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState<'cloud' | 'other' | null>(null);
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
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (address.trim()) void connect(address, 'other');
  };

  return (
    <AuthCard title={t('setup.title')} centered>
      <p className={AUTH_TEXT}>{t('desktop.connectText')}</p>
      <div className="flex flex-col items-center gap-3">
        <AppButton variant="plain" className={`${AUTH_SUBMIT} w-64`} loading={busy === 'cloud'} disabled={!!busy} onClick={() => void connect(desktop.cloud!, 'cloud')}>
          {t('desktop.signInCloud')}
        </AppButton>
        <p className="text-xs text-stone-400 dark:text-stone-500">{new URL(desktop.cloud!).host}</p>
      </div>
      {other ? (
        <form className="w-64 mx-auto space-y-3" onSubmit={submit}>
          <p className={AUTH_TEXT}>{t('desktop.otherText')}</p>
          <FloatingInput label={t('server.address')} type="url" inputMode="url" autoCapitalize="none" autoCorrect="off" autoFocus maxChars={200} value={address} onChange={(e) => setAddress(e.target.value)} />
          <div className="flex justify-center">
            <AppButton type="submit" disabled={!address.trim() || !!busy} loading={busy === 'other'}>
              {t('server.use')}
            </AppButton>
          </div>
        </form>
      ) : (
        <div className="flex justify-center">
          <AppButton variant="plain" className={SMALL_ACTION} disabled={!!busy} onClick={() => setOther(true)}>
            {t('desktop.otherServer')}
          </AppButton>
        </div>
      )}
      <FormError text={error} center />
      <div className="pt-8 flex flex-col items-center gap-2">
        <AppButton variant="plain" className={SMALL_ACTION} disabled={!!busy} onClick={onLocal}>
          {t('desktop.thisComputer')}
        </AppButton>
        <p className={`${AUTH_TEXT} text-xs`}>{t('desktop.thisComputerText')}</p>
      </div>
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
