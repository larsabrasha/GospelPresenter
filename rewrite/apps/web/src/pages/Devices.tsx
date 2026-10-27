import { useCallback, useEffect, useState } from 'react';
import { inviteRefusal, type Me, type PairedDevice, type UserRow } from '@gp/core';
import { api } from '../auth/api.ts';
import { errorText } from '../auth/errors.ts';
import { t } from '../i18n.ts';
import { AppButton } from '../ui/AppButton.tsx';
import { Dialog, DialogButtons, useConfirm } from '../ui/Dialog.tsx';
import { FloatingSelect } from '../ui/Floating.tsx';
import { DevicesPicture } from '../ui/icons.tsx';
import { CARD } from '../ui/List.tsx';
import { PageContainer, PageHeader } from '../ui/PageContainer.tsx';
import { QrCode } from '../ui/QrCode.tsx';
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
    <Dialog title={t('devices.codeTitle')} onClose={onClose} maxWidthClass="max-w-lg">
      <form
        className="space-y-4"
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
        <FloatingSelect label={t('devices.as')} value={userId} onChange={(e) => setUserId(e.target.value)}>
          {(users.length ? users : [{ id: me.userId, name: me.name }]).map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </FloatingSelect>
        {error && (
          <p className="text-sm text-red-500 dark:text-red-400" role="alert">
            {error}
          </p>
        )}
        <DialogButtons>
          <AppButton variant="cancel" onClick={onClose}>
            {t('auth.cancel')}
          </AppButton>
          <AppButton type="submit">{t('devices.showCode')}</AppButton>
        </DialogButtons>
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
    <Dialog title={t('devices.codeTitle')} onClose={onClose} maxWidthClass="max-w-lg">
      <p className="text-sm text-neutral-600 dark:text-neutral-300">{t('devices.codeText', { name })}</p>
      <p className={`font-mono text-5xl tracking-[0.3em] text-center my-4 ${expired ? 'text-neutral-400 dark:text-neutral-500' : ''}`} data-testid="pair-code">
        {code}
      </p>
      {/* The code goes in the fragment, which no server sees; the tablet's pairing page reads it from there. */}
      {!!urls?.length && !expired && (
        <div className="flex justify-center">
          <div className="bg-white p-3 rounded-lg w-48 h-48 flex items-center justify-center [&>svg]:w-full [&>svg]:h-full [&_.qr]:m-0">
            <QrCode value={`${urls[0]}/#pair=${code}`} label={t('devices.qr')} size={180} />
          </div>
        </div>
      )}
      {urls?.length ? (
        urls.map((url) => (
          <p key={url} className="text-sm text-neutral-600 dark:text-neutral-300 break-all">
            {t('devices.openOn', { url })}
          </p>
        ))
      ) : (
        urls && <p className="text-xs text-neutral-500 dark:text-neutral-400">{t('devices.lanOff')}</p>
      )}
      <DialogButtons>
        <AppButton onClick={onClose}>{t('common.close')}</AppButton>
      </DialogButtons>
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
    <PageContainer>
      <PageHeader title={t('devices.title')}>
        <AppButton onClick={() => setChoosing(true)}>{t('devices.pair')}</AppButton>
      </PageHeader>
      <p className="px-5 text-sm text-neutral-500 dark:text-neutral-400">{t('devices.text')}</p>
      {typeof devices === 'string' && <p className="px-5 text-sm text-red-500 dark:text-red-400">{devices}</p>}
      <div className={CARD}>
        {Array.isArray(devices) && !devices.length && (
          <div className="flex flex-col items-center justify-center text-center px-6 py-12 select-none">
            <DevicesPicture className="w-48 h-auto mb-6 text-neutral-300 dark:text-neutral-600" />
            <p className="text-neutral-500 dark:text-neutral-400">{t('devices.empty')}</p>
          </div>
        )}
        <ul aria-label={t('devices.title')}>
          {Array.isArray(devices) &&
            devices.map((d) => (
              <li key={d.id} className={`flex items-center gap-3 px-5 py-3 text-sm border-b border-neutral-100 dark:border-neutral-700/60 last:border-0 ${d.revokedAt ? 'opacity-50' : ''}`}>
                <div className="flex-1 min-w-0">
                  <div className="truncate">{d.name}</div>
                  <div className="text-xs text-neutral-500 dark:text-neutral-400">
                    {t('devices.paired', { date: when(d.createdAt) })} · {d.revokedAt ? t('devices.disconnected') : t('devices.lastSeen', { date: when(d.lastUsedAt) })}
                  </div>
                </div>
                {!d.revokedAt && (
                  <AppButton
                    variant="danger"
                    className="text-xs"
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
                  </AppButton>
                )}
              </li>
            ))}
        </ul>
      </div>
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
    </PageContainer>
  );
}
