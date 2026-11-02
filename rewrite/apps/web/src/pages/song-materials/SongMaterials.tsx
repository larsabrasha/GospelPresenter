import type { SongMaterial } from '@gp/core';
import { useRef, useState, type ReactNode } from 'react';
import { songMaterialsOf } from '../../db/queries.ts';
import { useData, useDb } from '../../db/react.tsx';
import { t } from '../../i18n.ts';
import { newId } from '../../ids.ts';
import { linkSource, readSongFile, SONG_FILE_ACCEPT } from '../../media/songFiles.ts';
import { formatBytes } from '../Storage.tsx';
import { AppButton } from '../../ui/AppButton.tsx';
import { useSaveFailed, useTrySave } from '../../ui/AutoSave.tsx';
import { afterWrite } from '../../ui/debounce.ts';
import { Dialog, DialogButtons, useConfirm } from '../../ui/Dialog.tsx';
import { Dropdown, MENU_ITEM } from '../../ui/Dropdown.tsx';
import { FloatingInput } from '../../ui/Floating.tsx';
import { ArrowTopRightOnSquareIcon, DocumentTextIcon, EllipsisOutlineIcon, LinkIcon, MusicalNoteIcon, PencilIcon, PlusIcon, TrashIcon } from '../../ui/icons.tsx';
import { GROUP } from '../../ui/Sheet.tsx';
import { MaterialViewer } from './MaterialViewer.tsx';

/** A row's icon: a PDF's page, a recording's note, a link's chain. */
function MaterialIcon({ m }: { m: SongMaterial }) {
  const icon = m.kind === 'link' ? <LinkIcon className="size-4" /> : m.contentType === 'application/pdf' ? <DocumentTextIcon className="size-4" /> : <MusicalNoteIcon className="size-4" />;
  const colour = m.kind === 'link' ? 'bg-sky-500' : m.contentType === 'application/pdf' ? 'bg-red-500' : 'bg-violet-500';
  return <span className={`shrink-0 size-7 rounded-lg flex items-center justify-center text-white ${colour}`}>{icon}</span>;
}

/** What a row says under its title: a link's source, a file's kind and size. */
function detail(m: SongMaterial): string {
  if (m.kind === 'link') return linkSource(m.url ?? '');
  return `${m.contentType === 'application/pdf' ? 'PDF' : t('material.recording')} · ${formatBytes(m.size ?? 0)}`;
}

/**
 * A song's material as one list (spec 02 "Song material"): each row opens it, a file in the viewer and a link where it
 * points; its … renames or removes it. `editable` adds, renames and removes; everyone signed in may open.
 */
export function MaterialList({ materials, editable, empty }: { materials: SongMaterial[]; editable: boolean; empty?: ReactNode }) {
  const db = useDb();
  const saveFailed = useSaveFailed();
  const { dialog, ask } = useConfirm();
  const [open, setOpen] = useState<SongMaterial | null>(null);
  const [renaming, setRenaming] = useState<SongMaterial | null>(null);
  if (!materials.length) return <>{empty}</>;
  return (
    <>
      {dialog}
      <ul className={GROUP} aria-label={t('material.title')}>
        {materials.map((m) => (
          <li key={m.id} className="flex items-center">
            {m.kind === 'link' ? (
              <a href={m.url ?? undefined} target="_blank" rel="noopener noreferrer" className="flex-1 min-w-0 flex items-center gap-3 px-4 py-2.5 min-h-12 no-underline text-stone-900 dark:text-stone-100">
                <MaterialIcon m={m} />
                <Title m={m} />
                <ArrowTopRightOnSquareIcon className="size-4 shrink-0 text-stone-400" />
              </a>
            ) : (
              <AppButton variant="plain" onClick={() => setOpen(m)} className="flex-1 min-w-0 flex items-center gap-3 px-4 py-2.5 min-h-12 text-left cursor-pointer">
                <MaterialIcon m={m} />
                <Title m={m} />
              </AppButton>
            )}
            {editable && (
              <Dropdown
                className="shrink-0 pr-2"
                menuClassName="w-44"
                button={{ className: 'size-9 rounded-full flex items-center justify-center cursor-pointer text-stone-400 hover:bg-raised', 'aria-label': t('material.options', { title: m.title }), title: t('presentation.options') }}
                trigger={<EllipsisOutlineIcon className="size-4" />}
              >
                <AppButton variant="plain" role="menuitem" className={MENU_ITEM} onClick={() => setRenaming(m)}>
                  <PencilIcon className="size-4" />
                  {t('presentation.renameMenu')}
                </AppButton>
                <AppButton
                  variant="plain"
                  role="menuitem"
                  className={`${MENU_ITEM} text-red-500! dark:text-red-400!`}
                  onClick={async () => {
                    const ok = await ask({ title: t('common.delete'), text: t('material.removeConfirm', { title: m.title }), bold: m.title, confirm: t('common.delete'), compact: true });
                    if (ok) afterWrite(db.mutate('removeSongMaterial', { id: m.id }), () => {}, saveFailed);
                  }}
                >
                  <TrashIcon className="size-4" strokeWidth={1.5} />
                  {t('common.delete')}
                </AppButton>
              </Dropdown>
            )}
          </li>
        ))}
      </ul>
      {open && <MaterialViewer material={open} onClose={() => setOpen(null)} />}
      {renaming && <RenameDialog material={renaming} onClose={() => setRenaming(null)} />}
    </>
  );
}

function Title({ m }: { m: SongMaterial }) {
  return (
    <span className="flex-1 min-w-0 flex flex-col">
      <span className="truncate text-[15px]">{m.title}</span>
      <span className="truncate text-xs text-stone-500 dark:text-stone-400">{detail(m)}</span>
    </span>
  );
}

/**
 * Noter och länkar on a song's page: the list, Ladda upp fil (a PDF or a recording) and Lägg till länk. The band reads
 * it from the presentations the song is in (PresentationMaterials).
 */
export function SongMaterials({ songId }: { songId: string }) {
  const db = useDb();
  const materials = useData((d) => songMaterialsOf(d, [songId]), [songId]) ?? [];
  const picker = useRef<HTMLInputElement>(null);
  const [linking, setLinking] = useState(false);
  const [failures, setFailures] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const upload = async (files: File[]) => {
    setBusy(true);
    const failed: string[] = [];
    for (const file of files) {
      const read = await readSongFile(file, { id: newId(), songId });
      if (typeof read === 'string') failed.push(t(read === 'type' ? 'material.failedType' : 'material.failedSize', { name: file.name }));
      else await db.addSongFile(read).catch(() => failed.push(t('material.failedOther', { name: file.name })));
    }
    setFailures(failed);
    setBusy(false);
  };
  return (
    <section className="pt-4 space-y-3" aria-label={t('material.title')}>
      <h2 className="text-lg font-bold text-stone-800 dark:text-stone-100">{t('material.title')}</h2>
      <MaterialList materials={materials} editable empty={<p className="text-sm text-stone-500 dark:text-stone-400">{t('material.empty')}</p>} />
      {failures.map((f) => (
        <p key={f} className="text-sm text-red-500 dark:text-red-400">
          {f}
        </p>
      ))}
      <div className="flex flex-wrap gap-2">
        <AppButton variant="secondary" className="flex items-center gap-1.5" disabled={busy} onClick={() => picker.current?.click()}>
          <PlusIcon className="size-4" />
          {busy ? t('material.uploading') : t('material.uploadFile')}
        </AppButton>
        <AppButton variant="secondary" className="flex items-center gap-1.5" onClick={() => setLinking(true)}>
          <LinkIcon className="size-4" />
          {t('material.addLink')}
        </AppButton>
      </div>
      <input
        ref={picker}
        type="file"
        multiple
        accept={SONG_FILE_ACCEPT}
        className="hidden"
        data-testid="song-file"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          void upload(files);
        }}
      />
      {linking && <LinkDialog songId={songId} onClose={() => setLinking(false)} />}
    </section>
  );
}

/** Lägg till länk: the address, and a name, which is the link's source (Spotify, YouTube …) when left blank. */
function LinkDialog({ songId, onClose }: { songId: string; onClose: () => void }) {
  const db = useDb();
  const trySave = useTrySave();
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [bad, setBad] = useState(false);
  return (
    <Dialog title={t('material.addLink')} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const address = url.trim();
          if (!/^https?:\/\/[^\s/?#]+[^\s]*$/i.test(address)) return setBad(true);
          if (!(await trySave(db.mutate('addSongLink', { id: newId(), songId, title: title.trim() || linkSource(address), url: address, createdAt: Date.now() })))) return;
          onClose();
        }}
      >
        <FloatingInput label={t('material.linkUrl')} autoFocus type="url" inputMode="url" maxLength={2000} value={url} hasError={bad} onChange={(e) => (setUrl(e.target.value), setBad(false))} />
        {bad && <p className="text-sm text-red-500 dark:text-red-400 -mt-2">{t('material.badUrl')}</p>}
        <FloatingInput label={t('material.linkTitle')} maxLength={200} value={title} placeholder={url.trim() ? linkSource(url.trim()) : undefined} onChange={(e) => setTitle(e.target.value)} />
        <DialogButtons>
          <AppButton variant="cancel" onClick={onClose}>
            {t('common.cancel')}
          </AppButton>
          <AppButton type="submit" disabled={!url.trim()}>
            {t('material.addLink')}
          </AppButton>
        </DialogButtons>
      </form>
    </Dialog>
  );
}

/** Renames a piece of material. */
function RenameDialog({ material, onClose }: { material: SongMaterial; onClose: () => void }) {
  const db = useDb();
  const trySave = useTrySave();
  const [title, setTitle] = useState(material.title);
  return (
    <Dialog title={t('presentation.renameShort')} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (title.trim() && title.trim() !== material.title && !(await trySave(db.mutate('renameSongMaterial', { id: material.id, title: title.trim() })))) return;
          onClose();
        }}
      >
        <FloatingInput label={t('material.linkTitle')} autoFocus maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
        <DialogButtons>
          <AppButton variant="cancel" onClick={onClose}>
            {t('common.cancel')}
          </AppButton>
          <AppButton type="submit" disabled={!title.trim()}>
            {t('common.save')}
          </AppButton>
        </DialogButtons>
      </form>
    </Dialog>
  );
}
