import { useCallback, useEffect, useState } from 'react';
import type { PairedDevice } from '@gp/core';
import { api } from '../auth/api.ts';
import { errorText } from '../auth/errors.ts';
import { t } from '../i18n.ts';
import { Button } from '../ui/Button.tsx';
import { Dialog, useConfirm } from '../ui/Dialog.tsx';
import { useToast } from '../ui/Toast.tsx';

const when = (ms: number) => new Date(ms).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' });

/** The code to type on the new device, with where the device should go. */
function PairCodeDialog({ code, expiresAt, onClose }: { code: string; expiresAt: number; onClose: () => void }) {
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
      <p>{t('devices.codeText')}</p>
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
    const r = await api<PairedDevice[]>('GET', '/pair/devices');
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
export function Devices() {
  const [devices, setDevices] = useState<PairedDevice[] | string | null>(null);
  const [code, setCode] = useState<{ code: string; expiresAt: number } | null>(null);
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
        <Button
          variant="primary"
          onClick={async () => {
            try {
              const r = await api<{ code: string; expiresAt: number }>('POST', '/pair/code');
              if (r.error) toast(errorText(r));
              else setCode(r.body);
            } catch {
              toast(t('auth.offline'));
            }
          }}
        >
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
                      const r = await api('DELETE', `/pair/devices/${encodeURIComponent(d.id)}`);
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
      {code && (
        <PairCodeDialog
          code={code.code}
          expiresAt={code.expiresAt}
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
