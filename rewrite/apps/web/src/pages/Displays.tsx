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
import { downloadQr, QrCode } from '../ui/QrCode.tsx';
import { useServerBase } from '../ui/serverBase.ts';

/** A new public output code (LIVE-R30), from the browser's random source. */
export function newDisplayCode(): string {
  return displayCode((n) => crypto.getRandomValues(new Uint8Array(n)));
}

/** Where anyone opens an output: the server's own address (spec 04 §7). */
export function watchUrl(code: string, base = location.origin): string {
  return `${base}${href({ page: 'watch', code })}`;
}

/** Where a saved screen's TV opens it (spec 04 §5, §7). */
export function screenUrl(d: Pick<Display, 'code' | 'name'>, base: string): string {
  return `${base}${href({ page: 'display', id: d.code, name: d.name, token: null })}`;
}

export function viewersText(n: number): string {
  return n === 1 ? t('displays.viewersOne') : t('displays.viewersMany', { n });
}

function CreateDialog({ kind, onClose }: { kind: Display['kind']; onClose: (made: Display | null) => void }) {
  const db = useDb();
  const [name, setName] = useState('');
  const submit = async () => {
    if (!name.trim()) return;
    const made = { id: newId(), name: name.trim(), code: newDisplayCode(), kind };
    await db.mutate('createDisplay', made);
    onClose(made);
  };
  return (
    <Dialog title={kind === 'screen' ? t('screens.add') : t('displays.create')} onClose={() => onClose(null)}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void submit();
        }}
      >
        <label className="field">
          {t('displays.name')}
          <input autoFocus maxLength={200} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="row end">
          <Button onClick={() => onClose(null)}>{t('common.cancel')}</Button>
          <Button variant="primary" type="submit" disabled={!name.trim()}>
            {t('common.create')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** A link as a QR code and as text to copy; for a public output also "Ladda ner som bild" (spec 04 §7). */
function LinkDialog({ title, url, download, onClose }: { title: string; url: string; download?: string; onClose: () => void }) {
  const toast = useToast();
  return (
    <Dialog title={title} onClose={onClose}>
      <QrCode value={url} label={t('displays.qr')} />
      <div className="row">
        <input className="grow" readOnly value={url} aria-label={t('displays.link')} onFocus={(e) => e.currentTarget.select()} />
        <Button onClick={() => void copyLink(url, () => toast(t('displays.copied')))}>{t('displays.copy')}</Button>
      </div>
      <div className="row end">
        {download && <Button onClick={() => downloadQr(url, download)}>{t('displays.download')}</Button>}
        <Button variant="primary" onClick={onClose}>
          {t('common.close')}
        </Button>
      </div>
    </Dialog>
  );
}

async function copyLink(url: string, done: () => void) {
  try {
    await navigator.clipboard.writeText(url);
    done();
  } catch {
    // No clipboard over plain http on the LAN: the link is on screen to copy by hand.
  }
}

/**
 * Skärmar (spec 04 §7): the organisation's saved screens, online or not, and
 * its public outputs, what each sends and how many watch. Admins only.
 */
export function Displays({ link }: { link: LiveLink }) {
  const db = useDb();
  const toast = useToast();
  const { dialog, ask } = useConfirm();
  const all = useData(listDisplays, []);
  const displays = all?.filter((d) => d.kind === 'public');
  const screens = all?.filter((d) => d.kind === 'screen');
  const { sessions, online } = useLiveSessions(link);
  const base = useServerBase();
  const [creating, setCreating] = useState<Display['kind'] | null>(null);
  const [showing, setShowing] = useState<Display | null>(null);

  const status = (d: Display) => {
    const s = sessions.find((x) => x.outputs.some((o) => o.id === d.id));
    const viewers = s?.outputs.find((o) => o.id === d.id)?.viewers ?? 0;
    return s ? `${t('displays.sending', { name: s.presentationName })} · ${viewersText(viewers)}` : null;
  };

  const copy = (d: Display) => copyLink(watchUrl(d.code, base), () => toast(t('displays.copied')));

  const renew = async (d: Display) => {
    if (!(await ask({ title: t('displays.newCode'), text: t('displays.newCodeConfirm', { name: d.name }), confirm: t('displays.newCode') }))) return;
    await db.mutate('newDisplayCode', { id: d.id, code: newDisplayCode() });
    toast(t('displays.newCodeDone'));
  };

  const remove = async (d: Display) => {
    if (!(await ask({ title: t('displays.delete'), text: t('displays.deleteConfirm', { name: d.name }), confirm: t('displays.delete') }))) return;
    await db.mutate('deleteDisplay', { id: d.id });
  };

  const screensCard = (
    <div className="card">
      <div className="row">
        <h2 className="grow">{t('screens.title')}</h2>
        <Button variant="primary" onClick={() => setCreating('screen')}>
          {t('screens.add')}
        </Button>
      </div>
      <p className="muted">{t('screens.text')}</p>
      {screens && !screens.length && <p className="muted">{t('screens.empty')}</p>}
      <ul className="list" aria-label={t('screens.title')}>
        {screens?.map((d) => (
          <li key={d.id} className="display-row row" aria-label={d.name}>
            <strong className="grow">{d.name}</strong>
            <span className={online.includes(d.id) ? 'ok small' : 'muted small'}>{online.includes(d.id) ? t('screens.online') : t('screens.offline')}</span>
            <Button onClick={() => setShowing(d)}>{t('screens.showLink')}</Button>
            <Button variant="danger" onClick={() => void remove(d)}>
              {t('displays.delete')}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );

  return (
    <section>
      {dialog}
      <h1>{t('displays.title')}</h1>
      {screensCard}
      <div className="card">
        <div className="row">
          <h2 className="grow">{t('displays.public')}</h2>
          <Button variant="primary" onClick={() => setCreating('public')}>
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
                <Button onClick={() => setShowing(d)}>{t('displays.showQr')}</Button>
                <Button onClick={() => void renew(d)}>{t('displays.newCode')}</Button>
                <Button variant="danger" onClick={() => void remove(d)}>
                  {t('displays.delete')}
                </Button>
              </div>
              {status(d) && <p className="ok small">{status(d)}</p>}
              <div className="row">
                <input className="grow" readOnly value={watchUrl(d.code, base)} aria-label={`${t('displays.link')} ${d.name}`} onFocus={(e) => e.currentTarget.select()} />
                <Button onClick={() => void copy(d)}>{t('displays.copy')}</Button>
              </div>
            </li>
          ))}
        </ul>
      </div>
      {creating && (
        <CreateDialog
          kind={creating}
          onClose={(made) => {
            setCreating(null);
            setShowing(made); // the new one's link and QR code at once (spec 04 §7)
          }}
        />
      )}
      {showing && (
        <LinkDialog
          title={showing.name}
          url={showing.kind === 'screen' ? screenUrl(showing, base) : watchUrl(showing.code, base)}
          download={showing.kind === 'public' ? `qr-${showing.code}.png` : undefined}
          onClose={() => setShowing(null)}
        />
      )}
    </section>
  );
}
