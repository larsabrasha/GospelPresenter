import { useState } from 'react';
import { displayCode, type Display } from '@gp/core';
import { useData, useDb } from '../db/react.tsx';
import { listDisplays } from '../db/queries.ts';
import { t } from '../i18n.ts';
import { newId } from '../ids.ts';
import { useLiveSessions, type LiveLink } from '../live/remote.ts';
import { Button } from '../ui/Button.tsx';
import { Dialog, useConfirm } from '../ui/Dialog.tsx';
import { href } from '../ui/router.ts';
import { useToast } from '../ui/Toast.tsx';

/** A new public output code (LIVE-R30), from the browser's random source. */
export function newDisplayCode(): string {
  return displayCode((n) => crypto.getRandomValues(new Uint8Array(n)));
}

/** Where anyone opens an output: the server's own address (spec 04 §7). */
export function watchUrl(code: string): string {
  return `${location.origin}${href({ page: 'watch', code })}`;
}

export function viewersText(n: number): string {
  return n === 1 ? t('displays.viewersOne') : t('displays.viewersMany', { n });
}

function CreateDialog({ onClose }: { onClose: () => void }) {
  const db = useDb();
  const [name, setName] = useState('');
  return (
    <Dialog title={t('displays.create')} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return;
          await db.mutate('createDisplay', { id: newId(), name, code: newDisplayCode(), kind: 'public' });
          onClose();
        }}
      >
        <label className="field">
          {t('displays.name')}
          <input autoFocus maxLength={200} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="row end">
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" type="submit" disabled={!name.trim()}>
            {t('common.create')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/**
 * Skärmar (spec 04 §7): the organisation's public outputs, what each sends
 * and how many watch. Admins only. Paired screens and the QR code are not
 * built yet: the link is shown to copy.
 */
export function Displays({ link }: { link: LiveLink }) {
  const db = useDb();
  const toast = useToast();
  const { dialog, ask } = useConfirm();
  const displays = useData(listDisplays, []);
  const { sessions } = useLiveSessions(link);
  const [creating, setCreating] = useState(false);

  const status = (d: Display) => {
    const s = sessions.find((x) => x.outputs.some((o) => o.id === d.id));
    const viewers = s?.outputs.find((o) => o.id === d.id)?.viewers ?? 0;
    return s ? `${t('displays.sending', { name: s.presentationName })} · ${viewersText(viewers)}` : null;
  };

  const copy = async (d: Display) => {
    try {
      await navigator.clipboard.writeText(watchUrl(d.code));
      toast(t('displays.copied'));
    } catch {
      // No clipboard over plain http on the LAN: the link is on screen to copy by hand.
    }
  };

  const renew = async (d: Display) => {
    if (!(await ask({ title: t('displays.newCode'), text: t('displays.newCodeConfirm', { name: d.name }), confirm: t('displays.newCode') }))) return;
    await db.mutate('newDisplayCode', { id: d.id, code: newDisplayCode() });
    toast(t('displays.newCodeDone'));
  };

  const remove = async (d: Display) => {
    if (!(await ask({ title: t('displays.delete'), text: t('displays.deleteConfirm', { name: d.name }), confirm: t('displays.delete') }))) return;
    await db.mutate('deleteDisplay', { id: d.id });
  };

  return (
    <section>
      {dialog}
      <h1>{t('displays.title')}</h1>
      <div className="card">
        <div className="row">
          <h2 className="grow">{t('displays.public')}</h2>
          <Button variant="primary" onClick={() => setCreating(true)}>
            {t('displays.create')}
          </Button>
        </div>
        <p className="muted">{t('displays.publicText')}</p>
        {displays && !displays.length && <p className="muted">{t('displays.empty')}</p>}
        <ul className="list" aria-label={t('displays.public')}>
          {displays?.map((d) => (
            <li key={d.id} className="display-row" aria-label={d.name}>
              <div className="row">
                <strong className="grow">{d.name}</strong>
                <Button onClick={() => void renew(d)}>{t('displays.newCode')}</Button>
                <Button variant="danger" onClick={() => void remove(d)}>
                  {t('displays.delete')}
                </Button>
              </div>
              {status(d) && <p className="ok small">{status(d)}</p>}
              <div className="row">
                <input className="grow" readOnly value={watchUrl(d.code)} aria-label={`${t('displays.link')} ${d.name}`} onFocus={(e) => e.currentTarget.select()} />
                <Button onClick={() => void copy(d)}>{t('displays.copy')}</Button>
              </div>
            </li>
          ))}
        </ul>
      </div>
      {creating && <CreateDialog onClose={() => setCreating(false)} />}
    </section>
  );
}
