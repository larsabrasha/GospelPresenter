import { useRef, useState } from 'react';
import { useDb, useSongSearch } from '../db/react.tsx';
import { t } from '../i18n.ts';
import { newId } from '../ids.ts';
import { FIRST_PART_LABEL } from './songEditorLook.ts';
import { AddButton, RoundButton } from '../ui/AddButton.tsx';
import { AppButton } from '../ui/AppButton.tsx';
import { useTrySave } from '../ui/AutoSave.tsx';
import { Highlight } from '../ui/Highlight.tsx';
import { ArrowDownTrayIcon, MusicalNoteOutlineIcon } from '../ui/icons.tsx';
import { byLetter } from './songLetters.ts';
import { markCreated, freshName } from '../ui/justCreated.ts';
import { href, navigate } from '../ui/router.ts';
import { Library } from '../ui/Library.tsx';
import { useSongImport } from './SongImport.tsx';

/**
 * + makes "Ny sång" at once and opens it with its name picked, to type over (Lars, 2026-11-04, as Notes makes a
 * note), numbered when the library has one by that name. A new song starts with its first part, Verse 1, to type in
 * (Lars, 2026-11-02).
 */
function useCreateSong(songs: { name: string }[] | undefined) {
  const db = useDb();
  const trySave = useTrySave();
  const busy = useRef(false);
  return async () => {
    if (busy.current) return;
    busy.current = true;
    const id = newId();
    const name = freshName(t('songs.new'), (songs ?? []).map((s) => s.name));
    if ((await trySave(db.mutate('createSong', { id, name }))) && (await trySave(db.mutate('addSongPart', { id: newId(), songId: id, labelText: FIRST_PART_LABEL, content: '' })))) {
      markCreated(id);
      navigate({ page: 'song', id });
    }
    busy.current = false;
  };
}

/**
 * The song library (spec 02, `/admin/songs`; Pages/Admin/Songs.razor), as Music's Låtar and Contacts (Lars,
 * 2026-11-02) on the libraries' common page (ui/Library.tsx): the songs in sections by letter with an index along the
 * edge when the list is long, + for Ny sång (made at once) and beside it a round button for the ProPresenter import. Dropped .pro
 * files import anywhere on the page.
 */
export function Songs() {
  const db = useDb();
  const [query, setQuery] = useState('');
  const { songs, shown, shownQuery } = useSongSearch(query);
  const create = useCreateSong(songs);
  const songImport = useSongImport(songs);

  return (
    <Library
      title={t('nav.songs')}
      items={songs}
      search={{ query, onQuery: setQuery, shown }}
      layout="list"
      renderRow={(s) => ({ title: <Highlight text={s.name} query={shownQuery} />, subtitle: s.author ? <Highlight text={s.author} query={shownQuery} /> : undefined })}
      sections={(list) => byLetter(list).map((section) => ({ key: section.letter, title: section.letter, items: section.songs }))}
      sorts={[
        { key: 'name', label: t('library.sort.name'), compare: (a, b) => a.name.localeCompare(b.name, 'sv'), sections: true },
        // Songs with no author last.
        { key: 'author', label: t('library.sort.author'), compare: (a, b) => (a.author ?? '\uffff').localeCompare(b.author ?? '\uffff', 'sv') || a.name.localeCompare(b.name, 'sv') },
      ]}
      open={(s) => href({ page: 'song', id: s.id })}
      manage
      rename={{ title: t('library.renameTitle'), label: t('song.name'), maxLength: 200, run: (s, name) => db.mutate('updateSong', { id: s.id, name }) }}
      remove={{
        ask: (items) => (items.length === 1 ? { text: t('song.trashConfirm', { name: items[0]!.name }), bold: items[0]!.name } : { text: t('library.trashMany', { n: items.length }) }),
        done: (items) => (items.length === 1 ? t('song.trashed', { name: items[0]!.name }) : t('library.trashedMany', { n: items.length })),
        run: (s) => db.mutate('trashSong', { id: s.id, at: Date.now() }),
      }}
      add={
        <>
          {/* The import floats beside +, quieter than it (Lars, 2026-11-02). */}
          <RoundButton
            text={songImport.busy ? t('songs.import.busy') : t('songs.import.short')}
            title={t('songs.import.menu')}
            icon={<ArrowDownTrayIcon className="size-5" />}
            disabled={songImport.busy}
            onClick={songImport.pick}
          />
          <AddButton label={t('songs.new')} onClick={() => void create()} />
        </>
      }
      notices={
        <>
          {songImport.input}
          {songImport.status}
          {songImport.dialog}
        </>
      }
      loading={t('common.loading')}
      empty={{ icon: <MusicalNoteOutlineIcon className="size-12 mb-3 text-stone-300 dark:text-stone-600" />, title: t('songs.emptyTitle'),
        text: t('songs.emptyText'),
        action: (
          <>
            <AppButton onClick={() => void create()}>{t('songs.emptyNew')}</AppButton>
            <AppButton variant="secondary" disabled={songImport.busy} onClick={songImport.pick}>
              {t('songs.import.menu')}
            </AppButton>
          </>
        ),
      }}
      noMatch={t('songs.noHits')}
      count={(n) => t(n === 1 ? 'songs.count.one' : 'songs.count.many', { n })}
      drop={{ label: t('songs.import.drop'), accept: '.pro', onFiles: (files) => void (songImport.busy || songImport.files(files)) }}
      testId="songs"
    />
  );
}
