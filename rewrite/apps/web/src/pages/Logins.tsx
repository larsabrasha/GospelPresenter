import { useCallback, useEffect, useState } from 'react';
import type { AuthState, LoginMethod } from '@gp/core';
import { api } from '../auth/api.ts';
import { errorText } from '../auth/errors.ts';
import { addPasskey, linkGoogle } from '../auth/passkey.ts';
import { deviceName } from '../auth/session.ts';
import { t } from '../i18n.ts';
import { Button } from '../ui/Button.tsx';
import { Dialog, useConfirm } from '../ui/Dialog.tsx';
import { navigate } from '../ui/router.ts';
import { useToast } from '../ui/Toast.tsx';
import { FormError } from './AuthCard.tsx';

/** How long the desktop app watches for a passkey or Google account added in the system browser (spec 06: 5 minutes). */
const WAIT_MS = 5 * 60_000;

/** The user's logins, or why they cannot be shown. */
async function fetchLogins(): Promise<LoginMethod[] | string> {
  try {
    const r = await api<LoginMethod[]>('GET', '/api/auth/logins');
    return r.error ? errorText(r) : r.body;
  } catch {
    return t('auth.offline');
  }
}

const day = (ms: number) => new Date(ms).toLocaleDateString('sv-SE');
const label = (l: LoginMethod) => l.name ?? (l.provider === 'google' ? t('logins.google') : t('logins.passkey'));

/** Asks for a name, then the passkey. */
function NameDialog({ title, text, initial, submit, onClose }: { title: string; text?: string; initial: string; submit: (name: string) => Promise<void>; onClose: () => void }) {
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog title={title} onClose={onClose}>
      {text && <p>{text}</p>}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim() || busy) return;
          setBusy(true);
          await submit(name.trim());
          setBusy(false);
        }}
      >
        <label className="field">
          {t('logins.name')}
          <input autoFocus maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="row end">
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" type="submit" disabled={!name.trim() || busy}>
            {t('common.save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/**
 * "Inloggningsmetoder": the signed-in user's own passkeys and Google
 * account (spec 01 `/profile`, in part). Online only: logins are not synced.
 * Adding one needs a recent sign-in; the last one cannot be removed, so a
 * user never locks themselves out (an admin's new invite is the way back).
 */
export function Logins({ error: initialError }: { error: string | null }) {
  const [list, setList] = useState<LoginMethod[] | string | null>(null);
  const logins = Array.isArray(list) ? list : null;
  const [methods, setMethods] = useState<AuthState | null>(null);
  const [error, setError] = useState<string | null>(initialError ? errorText({ error: initialError, body: null }) : null);
  const [dialog, setDialog] = useState<{ kind: 'add' } | { kind: 'rename'; login: LoginMethod } | null>(null);
  /** The desktop app, waiting for the system browser: the logins it had before. */
  const [waiting, setWaiting] = useState<string[] | null>(null);
  const toast = useToast();
  const confirm = useConfirm();

  const load = useCallback(async () => {
    const r = await fetchLogins();
    setList(r);
    return Array.isArray(r) ? r : null;
  }, []);

  useEffect(() => {
    void fetchLogins().then(setList);
    api<AuthState>('GET', '/api/auth/state').then(
      (r) => setMethods(r.error ? null : r.body),
      () => undefined,
    );
    // A refusal from linking Google arrives in the address once; keep it on screen, not in the address.
    if (initialError) navigate({ page: 'logins', error: null });
  }, [initialError]);

  // In the desktop app the ceremony runs in the system browser: watch for the new login to appear.
  useEffect(() => {
    if (!waiting) return;
    const until = Date.now() + WAIT_MS;
    const timer = setInterval(async () => {
      const now = await load();
      const added = now?.find((l) => !waiting.includes(`${l.provider}:${l.id}`));
      if (added || Date.now() > until) {
        setWaiting(null);
        if (added) toast(added.provider === 'google' ? t('logins.linked') : t('logins.added'));
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [waiting, load, toast]);

  const wait = () => setWaiting((logins ?? []).map((l) => `${l.provider}:${l.id}`));

  const remove = async (l: LoginMethod) => {
    const ok = await confirm.ask({ title: t('logins.removeTitle'), text: t('logins.removeConfirm', { name: label(l) }), confirm: t('logins.remove') });
    if (!ok) return;
    try {
      const r = await api('DELETE', `/api/auth/logins/${l.provider}/${encodeURIComponent(l.id)}`);
      if (r.error) setError(errorText(r));
      else toast(t('logins.removed', { name: label(l) }));
    } catch {
      setError(t('auth.offline'));
    }
    await load();
  };

  const only = logins?.length === 1;
  const hasGoogle = !!logins?.some((l) => l.provider === 'google');
  return (
    <section>
      <h1>{t('logins.title')}</h1>
      <p className="muted">{t('logins.text')}</p>
      <FormError text={error ?? (typeof list === 'string' ? list : null)} />
      <ul className="list" aria-label={t('logins.title')}>
        {logins?.map((l) => (
          <li key={`${l.provider}:${l.id}`} className="user-row">
            <div className="grow">
              <strong>{label(l)}</strong> <span className="muted">{l.provider === 'google' ? t('logins.google') : t('logins.passkey')}</span>
              <div className="small muted">{t('logins.dates', { created: day(l.createdAt), used: day(l.lastUsedAt) })}</div>
            </div>
            {l.provider === 'passkey' && <Button onClick={() => setDialog({ kind: 'rename', login: l })}>{t('logins.rename')}</Button>}
            <Button variant="danger" disabled={only} title={only ? t('logins.last') : undefined} onClick={() => void remove(l)}>
              {t('logins.remove')}
            </Button>
          </li>
        ))}
      </ul>
      {only && <p className="small muted">{t('logins.last')}</p>}
      {waiting ? (
        <div className="row">
          <p className="grow" role="status">
            {t('logins.waiting')}
          </p>
          <Button onClick={() => setWaiting(null)}>{t('auth.cancel')}</Button>
        </div>
      ) : (
        <div className="row">
          {methods?.passkeys && (
            <Button variant="primary" onClick={() => setDialog({ kind: 'add' })}>
              {t('logins.addPasskey')}
            </Button>
          )}
          {methods?.google && logins && !hasGoogle && (
            <Button
              onClick={async () => {
                setError(null);
                const problem = await linkGoogle();
                if (problem) setError(problem);
                else if (window.gpDesktop) wait();
              }}
            >
              {t('logins.linkGoogle')}
            </Button>
          )}
        </div>
      )}
      {dialog?.kind === 'add' && (
        <NameDialog
          title={t('logins.addPasskey')}
          text={t('logins.addText')}
          initial={deviceName()}
          onClose={() => setDialog(null)}
          submit={async (name) => {
            setError(null);
            const r = await addPasskey(name);
            setDialog(null);
            if (typeof r === 'string') setError(r);
            else if (r) {
              toast(t('logins.added'));
              await load();
            } else wait();
          }}
        />
      )}
      {dialog?.kind === 'rename' && (
        <NameDialog
          title={t('logins.renameTitle')}
          initial={label(dialog.login)}
          onClose={() => setDialog(null)}
          submit={async (name) => {
            try {
              const r = await api('PATCH', `/api/auth/logins/passkey/${encodeURIComponent(dialog.login.id)}`, { name });
              if (r.error) setError(errorText(r));
              else toast(t('logins.renamed'));
            } catch {
              setError(t('auth.offline'));
            }
            setDialog(null);
            await load();
          }}
        />
      )}
      {confirm.dialog}
    </section>
  );
}
