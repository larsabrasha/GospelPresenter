import { useState } from 'react';
import { useDb, useSongSearch } from '../db/react.tsx';
import { t } from '../i18n.ts';
import { newId } from '../ids.ts';
import { FIRST_PART_LABEL } from './songEditorLook.ts';
import { AddButton } from '../ui/AddButton.tsx';
import { AppButton } from '../ui/AppButton.tsx';
import { useTrySave } from '../ui/AutoSave.tsx';
import { Dialog, DialogButtons } from '../ui/Dialog.tsx';
import { FloatingInput } from '../ui/Floating.tsx';
import { Highlight } from '../ui/Highlight.tsx';
import { EmptySmall } from '../ui/Empty.tsx';
import { MusicalNoteOutlineIcon, TrashIcon } from '../ui/icons.tsx';
import { DropZone } from '../ui/DropZone.tsx';
import { CARD, ListLinkRow } from '../ui/List.tsx';
import { PageContainer, PageHeader } from '../ui/PageContainer.tsx';
import { SearchField } from '../ui/Picker.tsx';
import { href, navigate } from '../ui/router.ts';
import { useSongImport } from './SongImport.tsx';

/** "Skapa sång": a name, then the editor (spec 02, SONG-A1, A2; Components/Presentations/NameDialog.razor). */
function CreateSongDialog({ initial = '', onClose, onCreated }: { initial?: string; onClose: () => void; onCreated: (id: string) => void }) {
  const db = useDb();
  const trySave = useTrySave();
  const [name, setName] = useState(initial);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    const id = newId();
    if (!(await trySave(db.mutate('createSong', { id, name })))) {
      setSaving(false);
      return;
    }
    // A new song starts with its first part, Verse 1, to type in (Lars, 2026-11-02).
    await trySave(db.mutate('addSongPart', { id: newId(), songId: id, labelText: FIRST_PART_LABEL, content: '' }));
    onCreated(id);
  };
  return (
    <Dialog title={t('songs.createTitle')} onClose={onClose} maxWidthClass="max-w-2xl">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <FloatingInput label={t('song.name')} autoFocus maxLength={200} value={name} onChange={(e) => setName(e.target.value)} />
        <DialogButtons>
          <AppButton variant="cancel" onClick={onClose}>
            {t('common.cancel')}
          </AppButton>
          <AppButton type="submit" disabled={!name.trim() || saving}>
            {t('common.create')}
          </AppButton>
        </DialogButtons>
      </form>
    </Dialog>
  );
}

/** The song library (spec 02, `/admin/songs`; Pages/Admin/Songs.razor). */
export function Songs() {
  const [query, setQuery] = useState('');
  const { songs, shown, shownQuery } = useSongSearch(query);
  const [creating, setCreating] = useState(false);
  const songImport = useSongImport(songs);

  return (
    <PageContainer>
      {/* The whole page takes dropped .pro files (spec 02). */}
      <DropZone className="flex flex-col space-y-5" label={t('songs.import.drop')} accept=".pro" enabled={!songImport.busy} onFiles={(files) => void songImport.files(files)}>
        {/* Always here, also with no songs (the current app hides it then, with the import below to start from). */}
        <PageHeader title={t('nav.songs')}>
          <AddButton label={t('common.create')} onClick={() => setCreating(true)} />
        </PageHeader>
        {creating && <CreateSongDialog onClose={() => setCreating(false)} onCreated={(id) => navigate({ page: 'song', id })} />}
        {songImport.card}
        {songImport.dialog}
        <div className={CARD}>
          <div className="px-5 pt-4 pb-2 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-base/6 font-semibold">{t('songs.all', { n: songs?.length ?? 0 })}</h2>
              <AppButton variant="neutral" href={href({ page: 'trash', kind: 'Song' })} className="flex items-center gap-1.5">
                <TrashIcon className="size-4" />
                {t('nav.trash')}
              </AppButton>
            </div>
            {!!songs?.length && <SearchField value={query} onChange={setQuery} label={t('songs.search')} placeholder={t('songs.searchPlaceholder')} compact />}
          </div>
          {songs && !songs.length && (
            <EmptySmall icon={<MusicalNoteOutlineIcon className="size-12 mb-3 text-stone-300 dark:text-stone-600" />} title={t('songs.emptyTitle')} />
          )}
          {!!songs?.length && shown && !shown.length && <p className="px-5 py-4 text-stone-400 text-sm">{t('songs.noHits')}</p>}
          {!!shown?.length && (
            <ul aria-label={t('nav.songs')}>
              {shown.map((s) => (
                <ListLinkRow
                  key={s.id}
                  href={href({ page: 'song', id: s.id })}
                  title={
                    <span className="font-medium">
                      <Highlight text={s.name} query={shownQuery} />
                    </span>
                  }
                  subtitle={s.author ? <Highlight text={s.author} query={shownQuery} /> : ' '}
                />
              ))}
            </ul>
          )}
        </div>
      </DropZone>
    </PageContainer>
  );
}
