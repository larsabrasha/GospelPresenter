import { useState } from 'react';
import { displayCode, type Display } from '@gp/core';
import { useData, useDb } from '../db/react.tsx';
import { listDisplays } from '../db/queries.ts';
import { t } from '../i18n.ts';
import { newId } from '../ids.ts';
import { useLiveSessions, type LiveLink } from '../live/remote.ts';
import { AppButton } from '../ui/AppButton.tsx';
import { useTrySave } from '../ui/AutoSave.tsx';
import { CopyField } from '../ui/CopyField.tsx';
import { deleteAsk, Dialog, DialogButtons, useConfirm } from '../ui/Dialog.tsx';
import { EmptyPicture, PICTURE } from '../ui/Empty.tsx';
import { FloatingInput } from '../ui/Floating.tsx';
import { ArrowDownTrayIcon, LinkIcon, PlusIcon, PublicOutputsPicture, QrCodeIcon, ScreenIcon, ScreensPicture } from '../ui/icons.tsx';
import { CARD } from '../ui/List.tsx';
import { PageContainer, PageHeader } from '../ui/PageContainer.tsx';
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
  const trySave = useTrySave();
  const [name, setName] = useState('');
  const submit = async () => {
    if (!name.trim()) return;
    const made = { id: newId(), name: name.trim(), code: newDisplayCode(), kind };
    if (!(await trySave(db.mutate('createDisplay', made)))) return;
    onClose({ ...made, createdAt: null });
  };
  return (
    <Dialog title={kind === 'screen' ? t('screens.add') : t('displays.create')} onClose={() => onClose(null)} maxWidthClass="max-w-lg">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void submit();
        }}
      >
        <p className="text-sm text-neutral-500 dark:text-neutral-400 leading-relaxed">{kind === 'screen' ? t('screens.addText') : t('displays.addText')}</p>
        <FloatingInput label={t('displays.name')} autoFocus maxLength={200} value={name} onChange={(e) => setName(e.target.value)} />
        <DialogButtons>
          <AppButton variant="cancel" onClick={() => onClose(null)}>
            {t('common.cancel')}
          </AppButton>
          <AppButton type="submit" disabled={!name.trim()} title="Ctrl+Enter">
            {t('common.create')}
          </AppButton>
        </DialogButtons>
      </form>
    </Dialog>
  );
}

/**
 * A link as a QR code and as text to copy, with what to do with each (spec 04
 * §7). A screen's dialog is Displays.razor's: the QR code, "eller", then the
 * link. A public output's also has "Ladda ner som bild" and, under a line,
 * "Ny kod" (`renew`).
 */
function LinkDialog({ title, url, download, renew, onClose }: { title: string; url: string; download?: string; renew?: () => void; onClose: () => void }) {
  const toast = useToast();
  const screen = !download;
  return (
    <Dialog title={title} onClose={onClose} maxWidthClass="max-w-sm" showClose>
      <div className="space-y-2">
        <div className="flex justify-center">
          <div className="bg-white p-3 rounded-lg w-48 h-48 flex items-center justify-center [&>svg]:w-full [&>svg]:h-full [&_.qr]:m-0">
            <QrCode value={url} label={t('displays.qr')} />
          </div>
        </div>
        <p className="text-sm text-neutral-500 dark:text-neutral-400 text-center">{screen ? t('screens.scanHint') : t('displays.scanHint')}</p>
      </div>
      {screen && (
        <>
          <div className="mt-8! flex items-center gap-3">
            <div className="h-px flex-1 bg-neutral-200 dark:bg-neutral-700" />
            <span className="text-xs uppercase tracking-widest text-neutral-400 dark:text-neutral-500">{t('screens.or')}</span>
            <div className="h-px flex-1 bg-neutral-200 dark:bg-neutral-700" />
          </div>
          <p className="text-sm text-neutral-500 dark:text-neutral-400 leading-relaxed">{t('screens.linkHint')}</p>
        </>
      )}
      {download && (
        <div className="flex justify-center">
          <AppButton variant="secondary" className="text-xs flex items-center gap-1.5" onClick={() => downloadQr(url, download)}>
            <ArrowDownTrayIcon className="size-4" strokeWidth={1.5} />
            {t('displays.download')}
          </AppButton>
        </div>
      )}
      <CopyField value={url} label={t('displays.link')} copyLabel={t('displays.copy')} onCopy={() => void copyLink(url, () => toast(t('displays.copied')))} />
      {renew && (
        <div className="mt-8! pt-4 border-t border-neutral-200 dark:border-neutral-700 space-y-3">
          <p className="text-xs text-neutral-500 dark:text-neutral-400 leading-relaxed">{t('displays.newCodeText')}</p>
          <AppButton variant="danger" className="text-xs" onClick={renew}>
            {t('displays.newCode')}
          </AppButton>
        </div>
      )}
    </Dialog>
  );
}

/** Copies a link and says so; over plain http there is no clipboard, and nothing happens. */
export async function copyLink(url: string, done: () => void) {
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
  const trySave = useTrySave();
  const toast = useToast();
  const { dialog, ask } = useConfirm();
  const all = useData(listDisplays, []);
  const displays = all?.filter((d) => d.kind === 'public');
  const screens = all?.filter((d) => d.kind === 'screen');
  const { sessions, online } = useLiveSessions(link);
  const base = useServerBase();
  const [creating, setCreating] = useState<Display['kind'] | null>(null);
  const [showing, setShowing] = useState<Display | null>(null);

  /** The session sending to a public output, if one is, and how many watch it. */
  const status = (d: Display) => {
    const s = sessions.find((x) => x.outputs.some((o) => o.id === d.id));
    return { sending: s?.presentationName ?? null, viewers: s?.outputs.find((o) => o.id === d.id)?.viewers ?? 0 };
  };

  // As Displays.razor's: the old code's dialog closes, since its link and QR code no longer work.
  const renew = async (d: Display) => {
    if (!(await ask({ title: t('displays.newCode'), text: t('displays.newCodeConfirm', { name: d.name }), confirm: t('displays.newCode') }))) return;
    if (!(await trySave(db.mutate('newDisplayCode', { id: d.id, code: newDisplayCode() })))) return;
    setShowing(null);
    toast(t('displays.newCodeDone'));
  };

  const remove = async (d: Display) => {
    await ask(deleteAsk(t('displays.deleteConfirm', { name: d.name }), d.name, () => trySave(db.mutate('deleteDisplay', { id: d.id }))));
  };

  /** A section's add button: in its heading once the list has something, in the empty card before that. */
  const add = (kind: Display['kind']) => (
    <AppButton onClick={() => setCreating(kind)} className="flex items-center gap-1.5">
      <PlusIcon className="size-4" />
      {kind === 'screen' ? t('screens.add') : t('displays.create')}
    </AppButton>
  );
  const ROW = 'flex flex-wrap items-center gap-3 px-7 py-3 border-b border-neutral-200 dark:border-neutral-700 last:border-b-0';
  const SMALL = 'text-xs flex items-center gap-1.5';

  return (
    <PageContainer>
      {dialog}
      <PageHeader title={t('displays.title')}>{!!screens?.length && add('screen')}</PageHeader>
      <p className="px-5 text-sm text-neutral-500 dark:text-neutral-400">{t('screens.text')}</p>
      <div className={CARD}>
        {screens && !screens.length && (
          <EmptyPicture picture={<ScreensPicture className={PICTURE} />} title={t('screens.empty')}>
            {add('screen')}
          </EmptyPicture>
        )}
        <ul aria-label={t('screens.title')}>
          {screens?.map((d) => {
            const on = online.includes(d.id);
            return (
              <li key={d.id} className={ROW} aria-label={d.name}>
                <ScreenIcon className={`size-5 ${on ? 'text-green-500' : 'text-neutral-300 dark:text-neutral-600'}`} offline={!on} />
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{d.name}</div>
                </div>
                <div className={`text-xs ${on ? 'text-green-600 dark:text-green-400' : 'text-neutral-400 dark:text-neutral-500'}`}>{on ? t('screens.online') : t('screens.offline')}</div>
                <AppButton variant="neutral" className={SMALL} onClick={() => setShowing(d)}>
                  <LinkIcon className="size-3.5" />
                  {t('screens.showLink')}
                </AppButton>
                <AppButton variant="danger" className="text-xs" onClick={() => void remove(d)}>
                  {t('displays.delete')}
                </AppButton>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="flex items-center justify-between px-5 pt-6">
        <h2 className="text-xl/7 font-bold dark:text-neutral-100">{t('displays.public')}</h2>
        {!!displays?.length && add('public')}
      </div>
      <p className="px-5 text-sm text-neutral-500 dark:text-neutral-400">{t('displays.publicText')}</p>
      <div className={CARD}>
        {displays && !displays.length && (
          <EmptyPicture picture={<PublicOutputsPicture className={PICTURE} />} title={t('displays.empty')}>
            {add('public')}
          </EmptyPicture>
        )}
        <ul aria-label={t('displays.public')}>
          {displays?.map((d) => {
            const { sending, viewers } = status(d);
            return (
              <li key={d.id} className={ROW} aria-label={d.name}>
                <QrCodeIcon className={`size-5 ${sending ? 'text-green-500' : 'text-neutral-300 dark:text-neutral-600'}`} />
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{d.name}</div>
                  {sending && <div className="text-xs text-neutral-400 dark:text-neutral-500 truncate">{t('displays.sending', { name: sending })}</div>}
                </div>
                <div className={`text-xs ${viewers > 0 ? 'text-green-600 dark:text-green-400' : 'text-neutral-400 dark:text-neutral-500'}`}>{viewersText(viewers)}</div>
                <AppButton variant="neutral" className={SMALL} onClick={() => setShowing(d)}>
                  <QrCodeIcon className="size-3.5" />
                  {t('displays.showQr')}
                </AppButton>
                <AppButton variant="danger" className="text-xs" onClick={() => void remove(d)}>
                  {t('displays.delete')}
                </AppButton>
              </li>
            );
          })}
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
          renew={showing.kind === 'public' ? () => void renew(showing) : undefined}
          onClose={() => setShowing(null)}
        />
      )}
    </PageContainer>
  );
}
