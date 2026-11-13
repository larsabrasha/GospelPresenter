import { useState, type FormEvent } from 'react';
import { t } from '../i18n.ts';
import { chooseServer, serverChangeable, serverIsDefault, serverOrigin } from '../server.ts';
import { AppButton } from '../ui/AppButton.tsx';
import { FloatingInput } from '../ui/Floating.tsx';
import { AUTH_TEXT, FormError } from './AuthCard.tsx';

/** The addresses to try for what was typed: as typed with a scheme, else https first and then http (a host on a LAN). */
export function serverCandidates(typed: string): string[] {
  const text = typed.trim().replace(/\/+$/, '');
  if (!text) return [];
  if (/^https?:\/\//i.test(text)) return [text];
  return [`https://${text}`, `http://${text}`];
}

/** The first of `candidates` where a Gospel Presenter server answers its auth state; null when none does. */
async function answering(candidates: string[]): Promise<string | null> {
  for (const url of candidates) {
    try {
      const r = await fetch(`${url}/api/auth/state`, { signal: AbortSignal.timeout(5000) });
      const body = (await r.json()) as { passkeys?: unknown };
      if (r.ok && 'passkeys' in body) return new URL(url).origin;
    } catch {
      // Not there, or not this app's server: the next one.
    }
  }
  return null;
}

/**
 * The server, in grey at the foot of the sign-in page, in the phone app only: "Server: …" and Ändra, which opens a
 * field for a church's own server and a way back to the default (Lars, 2026-11-03: tucked away, as apps one may host
 * oneself have it). A server is taken only once it answers; the app then starts again against it.
 */
export function ServerChoice() {
  const [open, setOpen] = useState(false);
  const [address, setAddress] = useState('');
  const [state, setState] = useState<{ trying?: boolean; error?: string }>({});
  if (!serverChangeable) return null;
  const host = new URL(serverOrigin()).host;
  if (!open)
    return (
      <p className="pt-4 text-xs text-stone-400 dark:text-stone-500 text-center">
        {t('server.label', { host })}{' '}
        <AppButton variant="plain" className="text-sky-600 dark:text-sky-400 cursor-pointer hover:underline" onClick={() => setOpen(true)}>
          {t('server.change')}
        </AppButton>
      </p>
    );
  const use = async (e: FormEvent) => {
    e.preventDefault();
    setState({ trying: true });
    const found = await answering(serverCandidates(address));
    if (!found) return setState({ error: t('server.unreachable') });
    chooseServer(found);
    location.reload();
  };
  return (
    <form className="w-64 mx-auto pt-4 space-y-3" onSubmit={(e) => void use(e)}>
      <p className={AUTH_TEXT}>{t('server.text')}</p>
      <FloatingInput label={t('server.address')} type="url" inputMode="url" autoCapitalize="none" autoCorrect="off" autoFocus maxLength={200} value={address} onChange={(e) => setAddress(e.target.value)} />
      <FormError text={state.error ?? null} center />
      <div className="flex flex-col items-center gap-2">
        <AppButton type="submit" disabled={!address.trim()} loading={state.trying}>
          {t('server.use')}
        </AppButton>
        {!serverIsDefault() && (
          <AppButton
            variant="plain"
            className="text-sm text-sky-600 dark:text-sky-400 cursor-pointer hover:underline"
            onClick={() => {
              chooseServer(null);
              location.reload();
            }}
          >
            {t('server.default')}
          </AppButton>
        )}
      </div>
    </form>
  );
}
