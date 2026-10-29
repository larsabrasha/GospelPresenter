import type { Theme } from '@gp/core';
import { useEffect, useEffectEvent, useState, type ReactNode } from 'react';
import { t } from '../../i18n.ts';
import { AppButton } from '../../ui/AppButton.tsx';
import { Modal } from '../../ui/Dialog.tsx';
import { BookOpenIcon, MusicalNoteIcon, PhotoIcon, RectangleStackIcon, SpeakerWaveIcon } from '../../ui/icons.tsx';
import { PillTabs } from '../../ui/PillTabs.tsx';
import { ctrlLabel } from '../../ui/shortcuts.ts';
import { AudioTab } from '../AudioTab.tsx';
import { BibleTab } from '../BibleTab.tsx';
import { ImageTab } from '../ImageTab.tsx';
import { SongEditor } from '../SongEditor.tsx';
import { SlidesTab } from './SlidesTab.tsx';
import { SongTab } from './SongTab.tsx';

export interface TabProps {
  presentationId: string;
  afterItemId: string | null;
  theme: Theme;
  onAdded: (itemId: string) => void;
  onClose: () => void;
  /** Whether the tab is the one shown: it keeps its search and selection while another is. */
  active: boolean;
}

type Tab = 'songs' | 'bible' | 'images' | 'audio' | 'slides';
const ORDER: Tab[] = ['songs', 'bible', 'images', 'audio', 'slides'];

/**
 * The add-item modal (spec 03 2d): Sånger, Bibeltexter, Bilder, Ljud and PowerPoint; Ctrl/⌘+1 to
 * +5 switch, wherever focus is. Every tab stays as it was while another is shown (AddItemModal.razor
 * hides them). It never closes after an add (D15). The new item goes after the selected one and
 * becomes selected. A song's pencil opens its editor here, with a way back to the list.
 */
export function AddItemDialog({ toItemId, ...props }: Omit<TabProps, 'active'> & { toItemId?: string }) {
  // Adding pictures to an image item opens on Bilder.
  const [tab, setTab] = useState<Tab>(toItemId ? 'images' : 'songs');
  const [editingSongId, setEditingSongId] = useState<string | null>(null);
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    const at = Number(e.key) - 1;
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || !(at >= 0 && at < ORDER.length) || editingSongId) return;
    e.preventDefault();
    setTab(ORDER[at]!);
  });
  useEffect(() => {
    // On the window, in the capture phase: the dialog stops its keys from reaching the page, and focus may be anywhere.
    addEventListener('keydown', onKey, true);
    return () => removeEventListener('keydown', onKey, true);
  }, []);
  const tabs: [Tab, string, (p: { className?: string }) => ReactNode][] = [
    ['songs', t('nav.songs'), MusicalNoteIcon],
    ['bible', t('bible.tab'), BookOpenIcon],
    ['images', t('presentation.imagesTab'), PhotoIcon],
    ['audio', t('presentation.audioTab'), SpeakerWaveIcon],
    ['slides', t('slides.tab'), RectangleStackIcon],
  ];
  const shown = (key: Tab) => (!editingSongId && tab === key ? 'flex-1 min-h-0 flex flex-col' : 'hidden');
  const tabProps = (key: Tab): TabProps => ({ ...props, active: !editingSongId && tab === key });
  return (
    <Modal title={t('presentation.addTitle')} onClose={props.onClose} className="max-w-4xl">
      <div className="flex-1 min-h-0 flex flex-col">
        {editingSongId && (
          <div className="fixed inset-0 z-50 flex flex-col bg-white dark:bg-neutral-800 px-4 py-3 md:static md:inset-auto md:z-auto md:p-0 md:flex-1 md:min-h-0">
            <SongEditor id={editingSongId} onBack={() => setEditingSongId(null)} />
          </div>
        )}
        <div className={editingSongId ? 'hidden' : 'mb-4 md:flex md:justify-center'}>
          <PillTabs role="tablist">
            {tabs.map(([key, label, Icon], i) => (
              <AppButton key={key} variant={tab === key ? 'pillActive' : 'pill'} role="tab" aria-selected={tab === key} title={`${label} (${ctrlLabel(String(i + 1))})`} onClick={() => setTab(key)}>
                <Icon className="hidden md:block size-4" />
                {label}
              </AppButton>
            ))}
          </PillTabs>
        </div>
        <div className={shown('songs')}>
          <SongTab {...tabProps('songs')} onEditSong={setEditingSongId} />
        </div>
        <div className={shown('bible')}>
          <BibleTab {...tabProps('bible')} />
        </div>
        <div className={shown('images')}>
          <ImageTab {...tabProps('images')} toItemId={toItemId} />
        </div>
        <div className={shown('audio')}>
          <AudioTab {...tabProps('audio')} />
        </div>
        <div className={shown('slides')}>
          <SlidesTab {...tabProps('slides')} />
        </div>
      </div>
    </Modal>
  );
}
