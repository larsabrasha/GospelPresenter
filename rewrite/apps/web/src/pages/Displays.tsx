import { useState, type ReactNode } from 'react';
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
import { FloatingInput } from '../ui/Floating.tsx';
import { ACTION_ROW, DANGER_ROW, GROUP_ROW, Group } from '../ui/Group.tsx';
import { ArrowDownTrayIcon, PlusIcon, QrCodeIcon, ScreenIcon } from '../ui/icons.tsx';
import { RowChevron } from '../ui/List.tsx';
import { PageContainer, PageHeader } from '../ui/PageContainer.tsx';
import { href } from '../ui/router.ts';
import { useToast } from '../ui/Toast.tsx';
import { downloadQr, QrCode } from '../ui/QrCode.tsx';
import { useServerBase } from '../ui/serverBase.ts';
import { copyText } from '../ui/copyText.ts';
import { serverOrigin } from '../server.ts';

/** A new public output code (LIVE-R30), from the browser's random source. */
function randomDisplayCode(): string {
  return displayCode((n) => crypto.getRandomValues(new Uint8Array(n)));
}

/** Where anyone opens an output: the server's own address (spec 04 §7). */
function watchUrl(code: string, base = serverOrigin()): string {
  return `${base}${href({ page: 'watch', code })}`;
}

/** Where a saved screen's TV opens it (spec 04 §5, §7). */
function screenUrl(d: Pick<Display, 'code' | 'name'>, base: string): string {
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
    const made = { id: newId(), name: name.trim(), code: randomDisplayCode(), kind };
    if (!(await trySave(db.mutate('createDisplay', made)))) return;
    onClose({ ...made, createdAt: null });
  };
  return (
    <Dialog title={kind === 'screen' ? t('screens.addTitle') : t('displays.create')} onClose={() => onClose(null)} maxWidthClass="max-w-lg">
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
        <p className="text-sm text-stone-500 dark:text-stone-400 leading-relaxed">{kind === 'screen' ? t('screens.addText') : t('displays.addText')}</p>
        <FloatingInput label={t('displays.name')} autoFocus maxLength={200} value={name} onChange={(e) => setName(e.target.value)} />
        <DialogButtons>
          <AppButton variant="cancel" onClick={() => onClose(null)}>
            {t('common.cancel')}
          </AppButton>
          <AppButton type="submit" disabled={!name.trim()} title="Ctrl+Enter">
            {kind === 'screen' ? t('screens.add') : t('common.create')}
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
function LinkDialog({ title, url, download, renew, onRemove, onClose }: { title: string; url: string; download?: string; renew?: () => void; onRemove: () => void; onClose: () => void }) {
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
        <p className="text-sm text-stone-500 dark:text-stone-400 text-center">{screen ? t('screens.scanHint') : t('displays.scanHint')}</p>
      </div>
      {screen && (
        <>
          <div className="mt-8! flex items-center gap-3">
            <div className="h-px flex-1 bg-stone-200 dark:bg-raised" />
            <span className="text-sm text-stone-400 dark:text-stone-500">{t('screens.or')}</span>
            <div className="h-px flex-1 bg-stone-200 dark:bg-raised" />
          </div>
          <p className="text-sm text-stone-500 dark:text-stone-400 leading-relaxed">{t('screens.linkHint')}</p>
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
        <div className="mt-8! pt-4 border-t border-separator space-y-3">
          <p className="text-xs text-stone-500 dark:text-stone-400 leading-relaxed">{t('displays.newCodeText')}</p>
          <AppButton variant="danger" className="text-xs" onClick={renew}>
            {t('displays.newCode')}
          </AppButton>
        </div>
      )}
      {/* Radera in a group of its own, as every page has it. */}
      <div className="mt-6!">
        <Group>
          <AppButton variant="plain" className={DANGER_ROW} onClick={onRemove}>
            {t('displays.delete')}
          </AppButton>
        </Group>
      </div>
    </Dialog>
  );
}

/** Copies a link and says so (copyText.ts: over plain http too). */
async function copyLink(url: string, done: () => void) {
  if (await copyText(url)) done();
}

/** An output's row: its kind's icon, its name and a line under it, its status at the end; a tap opens its link. */
function OutputRow({ icon, name, line, status, live, label, onOpen }: { icon: ReactNode; name: string; line?: string | null; status: string; live: boolean; label: string; onOpen: () => void }) {
  return (
    <li aria-label={name}>
      <AppButton variant="plain" aria-label={label} className="flex items-center gap-3 w-full px-4 min-h-12 py-2 text-left cursor-pointer hover:bg-stone-200/60 dark:hover:bg-white/[0.06]" onClick={onOpen}>
        <span className={`shrink-0 ${live ? 'text-green-500' : 'text-stone-300 dark:text-stone-600'}`}>{icon}</span>
        <span className="flex-1 min-w-0">
          <span className="block truncate">{name}</span>
          {line && <span className="block text-xs text-stone-500 dark:text-stone-400 truncate">{line}</span>}
        </span>
        <span className={`text-sm ${live ? 'text-green-600 dark:text-green-400' : 'text-stone-400 dark:text-stone-500'}`}>{status}</span>
        <RowChevron />
      </AppButton>
    </li>
  );
}

/** A group's rows: its outputs, a grey line when there is none, and the row that adds one. */
function OutputGroup({ title, label, empty, add, onAdd, children }: { title: string; label: string; empty: string | null; add: string; onAdd: () => void; children: ReactNode }) {
  return (
    <Group title={title}>
      <ul aria-label={label} className="flex flex-col [&>li+li]:border-t-[0.5px] [&>li+li]:border-separator">
        {children}
      </ul>
      {empty && <p className={`${GROUP_ROW} text-stone-400 dark:text-stone-500`}>{empty}</p>}
      <AppButton variant="plain" className={ACTION_ROW} onClick={onAdd}>
        <span className="flex items-center gap-2">
          <PlusIcon className="size-4" />
          {add}
        </span>
      </AppButton>
    </Group>
  );
}

/**
 * Utgångar (spec 04 §7) as iOS's Bluetooth and AirPlay (Lars, 2026-11-04): where the presentation shows, on one
 * page. Fasta utgångar, the church's projectors, TVs and computers, each online or not; and Följ med, the links and
 * QR codes for phones, each what it sends and to how many. A tap opens an output's link and QR code, with Radera;
 * each group has its row that adds one. Admins only.
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
    if (!(await trySave(db.mutate('newDisplayCode', { id: d.id, code: randomDisplayCode() })))) return;
    setShowing(null);
    toast(t('displays.newCodeDone'));
  };

  const remove = async (d: Display) => {
    if (await ask(deleteAsk(t('displays.deleteConfirm', { name: d.name }), d.name, () => trySave(db.mutate('deleteDisplay', { id: d.id }))))) setShowing(null);
  };

  return (
    <PageContainer>
      {dialog}
      <PageHeader title={t('nav.displays')} />
      {!all && <div className="loading-line px-7 py-4 text-stone-400">{t('common.loading')}</div>}
      {all && (
        <>
          <OutputGroup title={t('screens.title')} label={t('screens.title')} empty={screens?.length ? null : t('screens.empty')} add={t('screens.addTitle')} onAdd={() => setCreating('screen')}>
            {screens?.map((d) => {
              const on = online.includes(d.id);
              return (
                <OutputRow
                  key={d.id}
                  icon={<ScreenIcon className="size-5" offline={!on} />}
                  name={d.name}
                  status={on ? t('screens.online') : t('screens.offline')}
                  live={on}
                  label={t('screens.showLinkFor', { name: d.name })}
                  onOpen={() => setShowing(d)}
                />
              );
            })}
          </OutputGroup>
          <OutputGroup title={t('displays.public')} label={t('displays.public')} empty={displays?.length ? null : t('displays.empty')} add={t('displays.create')} onAdd={() => setCreating('public')}>
            {displays?.map((d) => {
              const { sending, viewers } = status(d);
              return (
                <OutputRow
                  key={d.id}
                  icon={<QrCodeIcon className="size-5" />}
                  name={d.name}
                  line={sending && t('displays.sending', { name: sending })}
                  status={viewersText(viewers)}
                  live={viewers > 0 || !!sending}
                  label={t('displays.showQrFor', { name: d.name })}
                  onOpen={() => setShowing(d)}
                />
              );
            })}
          </OutputGroup>
        </>
      )}
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
          onRemove={() => void remove(showing)}
          onClose={() => setShowing(null)}
        />
      )}
    </PageContainer>
  );
}
