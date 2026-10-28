import { sortedArrangements, type PresentationItem } from '@gp/core';
import { useEffect, useEffectEvent, useState } from 'react';
import { useData, useDb } from '../../db/react.tsx';
import { arrangementsOf, getPresentation, itemsOf, listOverlays, songsById, themeOf } from '../../db/queries.ts';
import { t } from '../../i18n.ts';
import { slidesOf, type ItemSlides } from '../../live/live.ts';
import { useConfirm } from '../../ui/Dialog.tsx';
import { useKeepOffline } from '../../ui/MediaReadiness.tsx';
import { navigate } from '../../ui/router.ts';
import { useToast } from '../../ui/Toast.tsx';
import { AddItemDialog } from './AddItemDialog.tsx';
import { DetailsDialog } from './DetailsDialog.tsx';
import { ItemPane } from './ItemPane.tsx';
import { RunningOrder } from './RunningOrder.tsx';
import { SideMenu } from './SideMenu.tsx';

/** The presentation editor (spec 03 2): the running order on the left, the selected item on the right. */
export function PresentationEditor({ id }: { id: string }) {
  const db = useDb();
  const toast = useToast();
  const { dialog, ask } = useConfirm();
  const data = useData(
    async (d) => {
      const items = await itemsOf(d, id);
      const songIds = [...new Set(items.filter((i) => i.type === 'song').map((i) => i.sourceId))];
      const slides = new Map<string, ItemSlides>();
      for (const item of items) slides.set(item.id, await slidesOf(d, item));
      const presentation = await getPresentation(d, id);
      return {
        presentation,
        theme: await themeOf(d, presentation),
        items,
        slides,
        songs: await songsById(d, songIds),
        arrangements: await arrangementsOf(d, songIds),
        overlays: await listOverlays(d),
      };
    },
    [id],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [details, setDetails] = useState(false);
  const keep = useKeepOffline(id);
  const [renaming, setRenaming] = useState(false);
  // Below `lg` the running order is a drawer from the left, open when the page opens (Presentation.razor).
  const [menuVisible, setMenuVisible] = useState(true);

  const items = data?.items ?? [];
  const selected = items.find((i) => i.id === selectedId) ?? null;

  const removeItem = async (item: PresentationItem) => {
    const ok = await ask({ title: t('presentation.removeTitle'), text: t('presentation.removeConfirm', { title: item.title }), confirm: t('common.delete') });
    if (ok) void db.mutate('removeItem', { itemId: item.id });
  };

  // Page shortcuts (spec 03 section 6). A dialog stops its keys, so these never fire behind one.
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
    if (document.querySelector('[aria-modal="true"]')) return; // a dialog is open, even if focus slipped behind it (PRES-R37)
    if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      // Alt+↑/↓ moves the selected item one place: the keyboard's way to do what the drag handle does.
      if (!selected) return;
      e.preventDefault();
      void db.mutate('moveItem', { itemId: selected.id, by: e.key === 'ArrowUp' ? -1 : 1 });
      return;
    }
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === 'a') setAdding(true);
    else if (e.key === 'F2' && selected) setRenaming(true);
    else if (e.key === 'Delete' && selected) void removeItem(selected);
    else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && items.length && !e.shiftKey) {
      // PRES-R41: no wrap; the first ↓ lands on the first item, the first ↑ on the last.
      const at = items.findIndex((i) => i.id === selected?.id);
      const next = at === -1 ? (e.key === 'ArrowDown' ? 0 : items.length - 1) : Math.min(items.length - 1, Math.max(0, at + (e.key === 'ArrowDown' ? 1 : -1)));
      setSelectedId(items[next]!.id);
    } else return;
    e.preventDefault();
  });
  useEffect(() => {
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);

  if (!data) return null;
  const { presentation, slides, songs, theme, overlays } = data;
  if (!presentation || presentation.deletedAt !== null) return <p className="p-6 text-center text-sm text-neutral-500 dark:text-neutral-400">{t('presentation.notFound')}</p>;

  const trash = async () => {
    // To the trash without a dialog, with a toast that says where it went (PRES-R29).
    await db.mutate('trashPresentation', { id, at: Date.now() });
    toast(t('presentation.trashed', { name: presentation.name }));
    navigate({ page: 'presentations' });
  };

  const selectedSong = selected?.type === 'song' ? songs.get(selected.sourceId) : undefined;
  const selectedArrangements = selectedSong ? sortedArrangements(data.arrangements, selectedSong.id) : [];
  const selectedSlides = selected ? slides.get(selected.id) : undefined;

  return (
    <section className="flex-1 min-h-0 flex relative">
      {dialog}
      <SideMenu presentation={presentation} keep={keep} menuVisible={menuVisible} onHideMenu={() => setMenuVisible(false)} onEditDetails={() => setDetails(true)} onTrash={() => void trash()}>
        <RunningOrder
          items={items}
          slides={slides}
          overlays={overlays}
          selectedId={selectedId}
          onSelect={(itemId) => {
            setSelectedId(itemId);
            setRenaming(false);
            setMenuVisible(false);
          }}
          onRemove={(item) => void removeItem(item)}
          onAdd={() => setAdding(true)}
        />
      </SideMenu>
      <ItemPane
        id={id}
        items={items}
        selected={selected}
        renaming={renaming}
        setRenaming={setRenaming}
        selectedSong={selectedSong}
        selectedArrangements={selectedArrangements}
        selectedSlides={selectedSlides}
        overlays={overlays}
        theme={theme}
        onShowMenu={() => setMenuVisible(true)}
      />
      {adding && <AddItemDialog presentationId={id} afterItemId={selectedId} theme={theme} onAdded={setSelectedId} onClose={() => setAdding(false)} />}
      {details && (
        <DetailsDialog id={id} name={presentation.name} eventDate={presentation.eventDate} themeId={presentation.themeId} onClose={() => setDetails(false)} />
      )}
    </section>
  );
}
