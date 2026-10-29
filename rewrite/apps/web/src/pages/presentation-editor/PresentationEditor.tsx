import { can, sortedArrangements, type PresentationItem, type Role } from '@gp/core';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { useData, useDb } from '../../db/react.tsx';
import { arrangementsOf, getPresentation, itemsOf, listOverlays, songsById, themeOf } from '../../db/queries.ts';
import { t } from '../../i18n.ts';
import { slidesOf, type ItemSlides } from '../../live/live.ts';
import { useSaveFailed, useTrySave } from '../../ui/AutoSave.tsx';
import { afterWrite } from '../../ui/debounce.ts';
import { useConfirm } from '../../ui/Dialog.tsx';
import { useKeepOffline } from '../../ui/MediaReadiness.tsx';
import { navigate } from '../../ui/router.ts';
import { usePageKeys } from '../../ui/shortcuts.ts';
import { useShortcutGroup, type ShortcutGroup } from '../../ui/ShortcutHelp.tsx';
import type { LiveControl } from '../../live/remote.ts';
import { useLivePointer } from '../../live/useLive.ts';
import { EditTemplateDialog } from '../Templates.tsx';
import { useToast } from '../../ui/Toast.tsx';
import { AddItemDialog } from './AddItemDialog.tsx';
import { DetailsDialog } from './DetailsDialog.tsx';
import { ItemPane } from './ItemPane.tsx';
import { RunningOrder } from './RunningOrder.tsx';
import { SaveAsTemplateDialog } from './SaveAsTemplateDialog.tsx';
import { SideMenu } from './SideMenu.tsx';

/** The item last selected in each presentation, for this window's life: opened again, it is selected again. */
const lastSelected = new Map<string, string>();

/** How long after this window's own write a change of the presentation is taken as its own (a push's round trip). */
const OWN_WRITE_MS = 10_000;

/**
 * The presentation editor (spec 03 2): the running order on the left, the
 * selected item on the right. With `template`, a template's editor
 * (`/templates/{id}`): a banner says so, and there is no Starta presentation
 * and no Spara som mall.
 */
/** The editor's keys in the help dialog (Presentation.razor's scope); ↑ ↓ wherever focus is, as ProPresenter's. */
const KEYS: ShortcutGroup = {
  title: t('shortcuts.group.presentation'),
  lines: [
    { keys: ['a'], text: t('shortcuts.addItem') },
    { keys: ['F2'], text: t('shortcuts.renameItem') },
    { keys: ['Delete'], text: t('shortcuts.removeItem') },
    { keys: ['ArrowUp', 'ArrowDown'], text: t('shortcuts.moveThroughItems') },
    { keys: ['Alt+ArrowUp', 'Alt+ArrowDown'], text: t('shortcuts.moveItem') },
  ],
};

export function PresentationEditor({ id, role, live, template = false }: { id: string; role: Role; live: LiveControl; template?: boolean }) {
  const db = useDb();
  const trySave = useTrySave();
  const toast = useToast();
  const { dialog, ask } = useConfirm();
  const saveFailed = useSaveFailed();
  // "Kunde inte spara" when a write is refused.
  const failing = (write: Promise<void>) => afterWrite(write, () => {}, saveFailed);
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
  // This window's live slide: its item is marked in the running order and selected on open.
  const pointer = useLivePointer(live);
  const liveItemId = pointer.presentationId === id ? pointer.itemId : null;
  // On open, the item shown live, else the one selected when this presentation was last open (Presentation.razor).
  const [selectedId, setSelectedIdState] = useState<string | null>(() => liveItemId ?? lastSelected.get(id) ?? null);
  const setSelectedId = (itemId: string | null) => {
    setSelectedIdState(itemId);
    if (itemId) lastSelected.set(id, itemId);
  };
  // Select mode ("Markera"): items are ticked, then removed together (Sidebar.razor).
  const [ticking, setTicking] = useState(false);
  // The add dialog: open, and whether it adds pictures to the selected image item (Lägg till bilder).
  const [adding, setAdding] = useState<false | 'item' | 'images'>(false);
  const [details, setDetails] = useState(false);
  const [savingAsTemplate, setSavingAsTemplate] = useState(false);
  const keep = useKeepOffline(id);
  const [renaming, setRenaming] = useState(false);
  // Below `lg` the running order is a drawer from the left, open when the page opens (Presentation.razor).
  const [menuVisible, setMenuVisible] = useState(true);

  const items = data?.items ?? [];
  const selected = items.find((i) => i.id === selectedId) ?? null;

  // "Presentationen har uppdaterats" when another session changed it: its time of change moved while this window wrote nothing.
  const updatedAt = data?.presentation ? data.presentation.updatedAt : undefined;
  const seenUpdatedAt = useRef<number | null | undefined>(undefined);
  const changed = useEffectEvent((at: number | null) => {
    const was = seenUpdatedAt.current;
    seenUpdatedAt.current = at;
    if (was !== undefined && was !== at && Date.now() - db.lastWriteAt > OWN_WRITE_MS) toast(t('presentation.updatedElsewhere'));
  });
  useEffect(() => {
    if (updatedAt !== undefined) changed(updatedAt);
  }, [updatedAt]);

  const removeItem = async (item: PresentationItem) => {
    const ok = await ask({ title: t('common.delete'), text: t('presentation.removeConfirm', { title: item.title }), bold: item.title, confirm: t('common.delete'), compact: true });
    if (ok) failing(db.mutate('removeItem', { itemId: item.id }));
  };

  // Page shortcuts (spec 03 section 6), as ProPresenter's: ↑ ↓ change item wherever focus is, outside text
  // fields; never behind a dialog (PRES-R37), never a held key repeating (ui/shortcuts.ts).
  useShortcutGroup(KEYS);
  usePageKeys((e) => {
    if (ticking) return;
    if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      // Alt+↑/↓ moves the selected item one place: the keyboard's way to do what the drag handle does.
      if (!selected) return;
      e.preventDefault();
      failing(db.mutate('moveItem', { itemId: selected.id, by: e.key === 'ArrowUp' ? -1 : 1 }));
      return;
    }
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === 'a') setAdding('item');
    else if (e.key === 'F2' && selected) setRenaming(true);
    else if (e.key === 'Delete' && selected) void removeItem(selected);
    else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && items.length && !e.shiftKey) {
      // PRES-R41: no wrap; the first ↓ lands on the first item, the first ↑ on the last.
      const at = items.findIndex((i) => i.id === selected?.id);
      const next = at === -1 ? (e.key === 'ArrowDown' ? 0 : items.length - 1) : Math.min(items.length - 1, Math.max(0, at + (e.key === 'ArrowDown' ? 1 : -1)));
      setSelectedId(items[next]!.id);
      setMenuVisible(false);
    } else return;
    e.preventDefault();
  });

  if (!data) return null;
  const { presentation, slides, songs, theme, overlays } = data;
  // A template's id under /presentations, or the other way round, is not found either: said in the side menu (Sidebar.razor).
  if (!presentation || presentation.deletedAt !== null || presentation.isTemplate !== template)
    return (
      <section className="flex-1 min-h-0 flex">
        <aside className="hidden lg:block w-[300px] shrink-0 bg-white dark:bg-neutral-800">
          <p className="text-sm text-center text-neutral-500 pt-10">{t(template ? 'templates.notFound' : 'presentation.notFound')}</p>
        </aside>
        <div className="flex-1 bg-neutral-100 dark:bg-neutral-900 lg:hidden">
          <p className="text-sm text-center text-neutral-500 pt-10">{t(template ? 'templates.notFound' : 'presentation.notFound')}</p>
        </div>
        <div className="hidden lg:block flex-1 bg-neutral-100 dark:bg-neutral-900" />
      </section>
    );

  const removeItems = async (chosen: PresentationItem[]) => {
    const ok = await ask({
      title: t('common.delete'),
      text: chosen.length === 1 ? t('presentation.removeOne') : t('presentation.removeMany', { n: chosen.length }),
      confirm: t('common.delete'),
      compact: true,
      run: async () => {
        try {
          for (const item of chosen) await db.mutate('removeItem', { itemId: item.id });
        } catch (e) {
          console.error('save failed', e);
          saveFailed();
        }
      },
    });
    if (!ok) return;
    setTicking(false);
    toast(chosen.length === 1 ? t('presentation.removedOne') : t('presentation.removedMany', { n: chosen.length }));
  };

  const trash = async () => {
    // To the trash without a dialog, with a toast that says where it went (PRES-R29).
    if (!(await trySave(db.mutate(template ? 'trashTemplate' : 'trashPresentation', { id, at: Date.now() })))) return;
    toast(t('presentation.trashed', { name: presentation.name }));
    navigate({ page: template ? 'templates' : 'presentations' });
  };

  const selectedSong = selected?.type === 'song' ? songs.get(selected.sourceId) : undefined;
  const selectedArrangements = selectedSong ? sortedArrangements(data.arrangements, selectedSong.id) : [];
  const selectedSlides = selected ? slides.get(selected.id) : undefined;

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {template && <div className="bg-sky-500 text-white text-center py-1.5 text-sm font-medium shrink-0">{t('templates.banner')}</div>}
      <section className="flex-1 min-h-0 flex relative">
        {dialog}
        <SideMenu
          presentation={presentation}
          keep={keep}
          menuVisible={menuVisible}
          onHideMenu={() => setMenuVisible(false)}
          onEditDetails={() => setDetails(true)}
          onSaveAsTemplate={!template && can(role, 'ManageTemplates') ? () => setSavingAsTemplate(true) : undefined}
          onTrash={() => void trash()}
          ticking={ticking}
          onTicking={setTicking}
        >
          <RunningOrder
            items={items}
            slides={slides}
            overlays={overlays}
            selectedId={selectedId}
            liveItemId={liveItemId}
            ticking={ticking}
            onDoneTicking={() => setTicking(false)}
            onRemoveTicked={(chosen) => void removeItems(chosen)}
            onSelect={(itemId) => {
              setSelectedId(itemId);
              setRenaming(false);
              setMenuVisible(false);
            }}
            onRemove={(item) => void removeItem(item)}
            onAdd={() => setAdding('item')}
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
          canStart={!template && pointer.presentationId === null}
          onShowMenu={() => setMenuVisible(true)}
          onAddImages={() => setAdding('images')}
        />
        {adding && (
          <AddItemDialog
            presentationId={id}
            afterItemId={selectedId}
            theme={theme}
            toItemId={adding === 'images' ? (selectedId ?? undefined) : undefined}
            onAdded={setSelectedId}
            onClose={() => setAdding(false)}
          />
        )}
        {details &&
          (template ? (
            <EditTemplateDialog template={presentation} onClose={() => setDetails(false)} />
          ) : (
            <DetailsDialog presentation={presentation} onClose={() => setDetails(false)} />
          ))}
        {savingAsTemplate && <SaveAsTemplateDialog presentation={presentation} items={items} onClose={() => setSavingAsTemplate(false)} />}
      </section>
    </div>
  );
}
