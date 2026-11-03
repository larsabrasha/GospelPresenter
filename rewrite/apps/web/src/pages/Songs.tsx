import type { Song } from '@gp/core';
import { useMemo, useState } from 'react';
import { useDb, useSongSearch } from '../db/react.tsx';
import { t } from '../i18n.ts';
import { newId } from '../ids.ts';
import { FIRST_PART_LABEL } from './songEditorLook.ts';
import { AddButton, RoundButton } from '../ui/AddButton.tsx';
import { AppButton } from '../ui/AppButton.tsx';
import { useTrySave } from '../ui/AutoSave.tsx';
import { Dialog, DialogButtons } from '../ui/Dialog.tsx';
import { FloatingInput } from '../ui/Floating.tsx';
import { Highlight } from '../ui/Highlight.tsx';
import { EmptySmall } from '../ui/Empty.tsx';
import { ArrowDownTrayIcon, MusicalNoteOutlineIcon } from '../ui/icons.tsx';
import { DropMore, DropZone } from '../ui/DropZone.tsx';
import { ListCard, ListLinkRow } from '../ui/List.tsx';
import { CAPTION } from '../ui/Group.tsx';
import { byLetter } from './songLetters.ts';
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

/** From how many songs the list has an index along its edge to jump by letter. */
const INDEX_FROM = 20;

/**
 * The song library (spec 02, `/admin/songs`; Pages/Admin/Songs.razor), as Music's Låtar and Contacts (Lars,
 * 2026-11-02): the search under the title, the songs in sections by letter with an index along the edge when the list
 * is long, how many in grey under it, + for Ny sång and beside it a round button for the ProPresenter import. Dropped
 * .pro files import anywhere on the page.
 */
export function Songs() {
  const [query, setQuery] = useState('');
  const { songs, shown, shownQuery } = useSongSearch(query);
  const [creating, setCreating] = useState(false);
  const songImport = useSongImport(songs);
  const searching = !!shownQuery.trim();
  const sections = useMemo(() => (shown && !searching ? byLetter(shown) : null), [shown, searching]);
  const row = (s: Song) => (
    <ListLinkRow
      key={s.id}
      href={href({ page: 'song', id: s.id })}
      title={<Highlight text={s.name} query={shownQuery} />}
      subtitle={s.author ? <Highlight text={s.author} query={shownQuery} /> : undefined}
    />
  );

  return (
    <PageContainer>
      {/* The whole page takes dropped .pro files (spec 02). */}
      <DropZone className="flex flex-col space-y-4" label={t('songs.import.drop')} accept=".pro" enabled={!songImport.busy} onFiles={(files) => void songImport.files(files)}>
        <PageHeader title={t('nav.songs')}>
          {/* The import floats beside +, quieter than it (Lars, 2026-11-02). */}
          <RoundButton
            text={songImport.busy ? t('songs.import.busy') : t('songs.import.short')}
            title={t('songs.import.menu')}
            icon={<ArrowDownTrayIcon className="size-5" />}
            disabled={songImport.busy}
            onClick={songImport.pick}
          />
          <AddButton label={t('songs.new')} onClick={() => setCreating(true)} />
        </PageHeader>
        {songImport.input}
        {creating && <CreateSongDialog onClose={() => setCreating(false)} onCreated={(id) => navigate({ page: 'song', id })} />}
        {songImport.status}
        {songImport.dialog}
        {!!songs?.length && <SearchField compact filled value={query} onChange={setQuery} label={t('songs.search')} placeholder={t('songs.searchPlaceholder')} />}
        {songs && !songs.length && <EmptySmall icon={<MusicalNoteOutlineIcon className="size-12 mb-3 text-stone-300 dark:text-stone-600" />} title={t('songs.emptyTitle')} dropHint={t('songs.import.drop')} />}
        {!!songs?.length && shown && !shown.length && <p className="px-5 text-stone-400 text-sm">{t('songs.noHits')}</p>}
        {searching && !!shown?.length && <ListCard label={t('nav.songs')}>{shown.map(row)}</ListCard>}
        {sections && !!sections.length && (
          <div className="flex gap-1">
            <ul className="flex-1 min-w-0 space-y-4" aria-label={t('nav.songs')}>
              {sections.map((section) => (
                <li key={section.letter} id={`songs-${section.letter}`} className="space-y-1.5 scroll-mt-4">
                  <h2 className={CAPTION}>{section.letter}</h2>
                  <ListCard>{section.songs.map(row)}</ListCard>
                </li>
              ))}
            </ul>
            {/* The index along the edge, as Contacts': a tap jumps to the letter. */}
            {shown!.length >= INDEX_FROM && (
              <nav aria-label={t('songs.index')} className="sticky top-2 self-start flex flex-col items-center py-1">
                {sections.map((section) => (
                  <AppButton
                    key={section.letter}
                    variant="plain"
                    onClick={() => document.getElementById(`songs-${section.letter}`)?.scrollIntoView({ block: 'start' })}
                    className="w-5 text-[11px]/4 font-semibold text-sky-600 dark:text-sky-400 cursor-pointer hover:underline"
                  >
                    {section.letter}
                  </AppButton>
                ))}
              </nav>
            )}
          </div>
        )}
        {!!shown?.length && <p className="text-center text-sm text-stone-500 dark:text-stone-400">{t(shown.length === 1 ? 'songs.count.one' : 'songs.count.many', { n: shown.length })}</p>}
        {!!songs?.length && <DropMore text={t('songs.import.drop')} />}
      </DropZone>
    </PageContainer>
  );
}
