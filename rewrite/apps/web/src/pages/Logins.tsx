import { useCallback, useEffect, useState } from 'react';
import type { AuthState, LoginMethod } from '@gp/core';
import { api } from '../auth/api.ts';
import { errorText } from '../auth/errors.ts';
import { addPasskey, linkGoogle } from '../auth/passkey.ts';
import { deviceName } from '../auth/session.ts';
import { t } from '../i18n.ts';
import { AppButton } from '../ui/AppButton.tsx';
import { Dialog, DialogButtons, useConfirm } from '../ui/Dialog.tsx';
import { FloatingInput } from '../ui/Floating.tsx';
import { CARD } from '../ui/List.tsx';
import { DetailHeader, PageContainer } from '../ui/PageContainer.tsx';
import { navigate } from '../ui/router.ts';
import { useToast } from '../ui/Toast.tsx';

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
    <Dialog title={title} onClose={onClose} maxWidthClass="max-w-2xl">
      {text && <p className="text-sm text-neutral-600 dark:text-neutral-300">{text}</p>}
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim() || busy) return;
          setBusy(true);
          await submit(name.trim());
          setBusy(false);
        }}
      >
        <FloatingInput label={t('logins.name')} autoFocus maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
        <DialogButtons>
          <AppButton variant="cancel" onClick={onClose}>
            {t('common.cancel')}
          </AppButton>
          <AppButton type="submit" disabled={!name.trim() || busy}>
            {t('common.save')}
          </AppButton>
        </DialogButtons>
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
  const failure = error ?? (typeof list === 'string' ? list : null);
  return (
    <PageContainer>
      <DetailHeader title={t('logins.title')} className="px-5" />
      <div className={`${CARD} p-5 space-y-4`}>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">{t('logins.text')}</p>
        {failure && (
          <p className="text-sm text-red-500 dark:text-red-400" role="alert">
            {failure}
          </p>
        )}
        <ul className="space-y-3 empty:hidden" aria-label={t('logins.title')}>
          {logins?.map((l) => (
            <li key={`${l.provider}:${l.id}`} className="flex items-center gap-3 p-3 bg-white dark:bg-neutral-700 rounded-xl border border-neutral-200 dark:border-neutral-600">
              <div className="flex-1 min-w-0">
                <div className="text-sm truncate">
                  <span className="font-medium">{label(l)}</span> <span className="text-neutral-500 dark:text-neutral-400">{l.provider === 'google' ? t('logins.google') : t('logins.passkey')}</span>
                </div>
                <div className="text-xs text-neutral-500 dark:text-neutral-400">{t('logins.dates', { created: day(l.createdAt), used: day(l.lastUsedAt) })}</div>
              </div>
              {l.provider === 'passkey' && (
                <AppButton variant="neutral" className="px-3! py-1.5!" onClick={() => setDialog({ kind: 'rename', login: l })}>
                  {t('logins.rename')}
                </AppButton>
              )}
              <AppButton variant="danger" className="px-3! py-1.5!" disabled={only} title={only ? t('logins.last') : undefined} onClick={() => void remove(l)}>
                {t('logins.remove')}
              </AppButton>
            </li>
          ))}
        </ul>
        {only && <p className="text-xs text-neutral-500 dark:text-neutral-400">{t('logins.last')}</p>}
        {waiting ? (
          <div className="flex items-center gap-3">
            <p className="flex-1 text-sm text-neutral-600 dark:text-neutral-300" role="status">
              {t('logins.waiting')}
            </p>
            <AppButton variant="cancel" onClick={() => setWaiting(null)}>
              {t('auth.cancel')}
            </AppButton>
          </div>
        ) : (
          <div className="flex flex-wrap justify-center gap-3 empty:hidden">
            {methods?.passkeys && <AppButton onClick={() => setDialog({ kind: 'add' })}>{t('logins.addPasskey')}</AppButton>}
            {methods?.google && logins && !hasGoogle && (
              <AppButton
                variant="secondary"
                onClick={async () => {
                  setError(null);
                  const problem = await linkGoogle();
                  if (problem) setError(problem);
                  else if (window.gpDesktop) wait();
                }}
              >
                {t('logins.linkGoogle')}
              </AppButton>
            )}
          </div>
        )}
      </div>
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
    </PageContainer>
  );
}
