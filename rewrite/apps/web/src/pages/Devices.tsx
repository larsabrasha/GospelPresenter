import { useCallback, useEffect, useState } from 'react';
import { inviteRefusal, type Me, type PairedDevice, type UserRow } from '@gp/core';
import { api } from '../auth/api.ts';
import { errorText } from '../auth/errors.ts';
import { t } from '../i18n.ts';
import { Button } from '../ui/Button.tsx';
import { Dialog, useConfirm } from '../ui/Dialog.tsx';
import { useToast } from '../ui/Toast.tsx';

const when = (ms: number) => new Date(ms).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' });

/** Who the new device will be signed in as: the caller, or a member they may make an invite for (D20, D21). */
function PairAsDialog({ me, onCode, onClose }: { me: Me; onCode: (c: { code: string; expiresAt: number; name: string }) => void; onClose: () => void }) {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [userId, setUserId] = useState(me.userId);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<UserRow[]>('GET', '/api/users').then(
      (r) => !r.error && setUsers(r.body.filter((u) => u.id === me.userId || !inviteRefusal({ id: me.userId, role: me.role }, u))),
      () => undefined,
    );
  }, [me]);
  return (
    <Dialog title={t('devices.codeTitle')} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            const r = await api<{ code: string; expiresAt: number }>('POST', '/api/pair/code', { userId });
            if (r.error) return setError(errorText(r));
            onCode({ ...r.body, name: users.find((u) => u.id === userId)?.name ?? me.name });
          } catch {
            setError(t('auth.offline'));
          }
        }}
      >
        <label className="field">
          {t('devices.as')}
          <select value={userId} onChange={(e) => setUserId(e.target.value)}>
            {(users.length ? users : [{ id: me.userId, name: me.name }]).map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </label>
        {error && (
          <p className="danger" role="alert">
            {error}
          </p>
        )}
        <div className="row end">
          <Button onClick={onClose}>{t('auth.cancel')}</Button>
          <Button variant="primary" type="submit">
            {t('devices.showCode')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** The code to type on the new device, with where the device should go. */
function PairCodeDialog({ code, expiresAt, name, onClose }: { code: string; expiresAt: number; name: string; onClose: () => void }) {
  const [urls, setUrls] = useState<string[] | null>(null);
  useEffect(() => void window.gpDesktop?.lanUrls().then(setUrls), []);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const expired = now >= expiresAt;
  return (
    <Dialog title={t('devices.codeTitle')} onClose={onClose}>
      <p>{t('devices.codeText', { name })}</p>
      <p className={expired ? 'pair-code-show muted' : 'pair-code-show'} data-testid="pair-code">
        {code}
      </p>
      {urls?.length ? urls.map((url) => <p key={url}>{t('devices.openOn', { url })}</p>) : urls && <p className="muted small">{t('devices.lanOff')}</p>}
      <div className="row end">
        <Button variant="primary" onClick={onClose}>
          {t('common.close')}
        </Button>
      </div>
    </Dialog>
  );
}

/** The paired devices, or why they cannot be shown. */
async function fetchDevices(): Promise<PairedDevice[] | string> {
  try {
    const r = await api<PairedDevice[]>('GET', '/api/pair/devices');
    return r.error ? errorText(r) : r.body;
  } catch {
    return t('auth.offline');
  }
}

/**
 * The desktop host's paired devices (ADR 0007, decision 6). Only the host's
 * own window, signed in as an Admin, can pair or disconnect; the server
 * checks both.
 */
export function Devices({ me }: { me: Me }) {
  const [devices, setDevices] = useState<PairedDevice[] | string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [code, setCode] = useState<{ code: string; expiresAt: number; name: string } | null>(null);
  const toast = useToast();
  const { dialog, ask } = useConfirm();

  const load = useCallback(() => fetchDevices().then(setDevices), []);
  useEffect(() => {
    void fetchDevices().then(setDevices);
  }, []);

  return (
    <section>
      <div className="row">
        <h1 className="grow">{t('devices.title')}</h1>
        <Button variant="primary" onClick={() => setChoosing(true)}>
          {t('devices.pair')}
        </Button>
      </div>
      <p className="muted">{t('devices.text')}</p>
      {typeof devices === 'string' && <p className="danger">{devices}</p>}
      {Array.isArray(devices) && !devices.length && <p className="empty">{t('devices.empty')}</p>}
      <ul className="list" aria-label={t('devices.title')}>
        {Array.isArray(devices) &&
          devices.map((d) => (
            <li key={d.id} className={d.revokedAt ? 'user-row muted' : 'user-row'}>
              <div className="grow">
                <strong>{d.name}</strong>
                <div className="small">
                  {t('devices.paired', { date: when(d.createdAt) })} · {d.revokedAt ? t('devices.disconnected') : t('devices.lastSeen', { date: when(d.lastUsedAt) })}
                </div>
              </div>
              {!d.revokedAt && (
                <Button
                  variant="danger"
                  onClick={async () => {
                    if (!(await ask({ title: t('devices.disconnect'), text: t('devices.disconnectConfirm', { name: d.name }), confirm: t('devices.disconnect') }))) return;
                    try {
                      const r = await api('DELETE', `/api/pair/devices/${encodeURIComponent(d.id)}`);
                      if (r.error) toast(errorText(r));
                    } catch {
                      toast(t('auth.offline'));
                    }
                    await load();
                  }}
                >
                  {t('devices.disconnect')}
                </Button>
              )}
            </li>
          ))}
      </ul>
      {choosing && (
        <PairAsDialog
          me={me}
          onClose={() => setChoosing(false)}
          onCode={(c) => {
            setChoosing(false);
            setCode(c);
          }}
        />
      )}
      {code && (
        <PairCodeDialog
          code={code.code}
          expiresAt={code.expiresAt}
          name={code.name}
          onClose={() => {
            setCode(null);
            void load();
          }}
        />
      )}
      {dialog}
    </section>
  );
}
