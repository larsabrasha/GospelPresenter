import { useState } from 'react';
import { useDb, useSongSearch } from '../db/react.tsx';
import { t } from '../i18n.ts';
import { newId } from '../ids.ts';
import { AppButton } from '../ui/AppButton.tsx';
import { useTrySave } from '../ui/AutoSave.tsx';
import { Dialog, DialogButtons } from '../ui/Dialog.tsx';
import { FloatingInput } from '../ui/Floating.tsx';
import { Highlight } from '../ui/Highlight.tsx';
import { MusicalNoteOutlineIcon, PlusIcon, TrashIcon } from '../ui/icons.tsx';
import { CARD, ListLinkRow } from '../ui/List.tsx';
import { PageContainer, PageHeader } from '../ui/PageContainer.tsx';
import { SearchField } from '../ui/Picker.tsx';
import { href, navigate } from '../ui/router.ts';

/** "Skapa sång": a name, then the editor (spec 02, SONG-A1, A2; Components/Presentations/NameDialog.razor). */
export function CreateSongDialog({ initial = '', onClose, onCreated }: { initial?: string; onClose: () => void; onCreated: (id: string) => void }) {
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

  return (
    <PageContainer>
      {/* Always here, also with no songs (the current app hides it then and offers the import): there is no import yet. */}
      <PageHeader title={t('nav.songs')}>
        <AppButton onClick={() => setCreating(true)} className="flex items-center gap-1.5">
          <PlusIcon className="size-4" />
          {t('common.create')}
        </AppButton>
      </PageHeader>
      {creating && <CreateSongDialog onClose={() => setCreating(false)} onCreated={(id) => navigate({ page: 'song', id })} />}
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
          <div className="flex flex-col items-center justify-center text-center text-sm py-12 px-6 select-none">
            <MusicalNoteOutlineIcon className="size-12 mb-3 text-neutral-300 dark:text-neutral-600" />
            <p className="font-medium text-neutral-500 dark:text-neutral-400 mb-1">{t('songs.emptyTitle')}</p>
            <p className="text-xs text-neutral-400 dark:text-neutral-500 max-w-xs leading-relaxed">{t('songs.emptyText')}</p>
          </div>
        )}
        {!!songs?.length && shown && !shown.length && <p className="px-5 py-4 text-neutral-400 text-sm">{t('songs.noHits')}</p>}
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
    </PageContainer>
  );
}
