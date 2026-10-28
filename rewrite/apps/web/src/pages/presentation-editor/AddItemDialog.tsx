import type { Theme } from '@gp/core';
import { useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { t } from '../../i18n.ts';
import { AppButton } from '../../ui/AppButton.tsx';
import { Modal } from '../../ui/Dialog.tsx';
import { BookOpenIcon, MusicalNoteIcon, PhotoIcon, SpeakerWaveIcon } from '../../ui/icons.tsx';
import { PillTabs } from '../../ui/PillTabs.tsx';
import { AudioTab } from '../AudioTab.tsx';
import { BibleTab } from '../BibleTab.tsx';
import { ImageTab } from '../ImageTab.tsx';
import { SongTab } from './SongTab.tsx';

export interface TabProps {
  presentationId: string;
  afterItemId: string | null;
  theme: Theme;
  onAdded: (itemId: string) => void;
  onClose: () => void;
}

/**
 * The add-item modal (spec 03 2d): Sånger, Bibeltexter, Bilder and Ljud, Ctrl/⌘+1 to +4
 * switch. It never closes after an add (D15). The new item goes after the
 * selected one and becomes selected.
 */
export function AddItemDialog(props: TabProps) {
  const [tab, setTab] = useState<'songs' | 'bible' | 'images' | 'audio'>('songs');
  const onKeyDown = (e: ReactKeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && ['1', '2', '3', '4'].includes(e.key)) {
      e.preventDefault();
      setTab(({ '1': 'songs', '2': 'bible', '3': 'images', '4': 'audio' } as const)[e.key as '1' | '2' | '3' | '4']);
    }
  };
  const tabs: [typeof tab, string, (p: { className?: string }) => ReactNode][] = [
    ['songs', t('nav.songs'), MusicalNoteIcon],
    ['bible', t('bible.tab'), BookOpenIcon],
    ['images', t('presentation.imagesTab'), PhotoIcon],
    ['audio', t('presentation.audioTab'), SpeakerWaveIcon],
  ];
  return (
    <Modal title={t('presentation.addTitle')} onClose={props.onClose} className="max-w-4xl">
      <div className="flex-1 min-h-0 flex flex-col" onKeyDown={onKeyDown}>
        <div className="mb-4 md:flex md:justify-center">
          <PillTabs role="tablist">
            {tabs.map(([key, label, Icon]) => (
              <AppButton key={key} variant={tab === key ? 'pillActive' : 'pill'} role="tab" aria-selected={tab === key} onClick={() => setTab(key)}>
                <Icon className="hidden md:block size-4" />
                {label}
              </AppButton>
            ))}
          </PillTabs>
        </div>
        {tab === 'songs' && <SongTab key="songs" {...props} />}
        {tab === 'bible' && <BibleTab key="bible" {...props} />}
        {tab === 'images' && <ImageTab key="images" {...props} />}
        {tab === 'audio' && <AudioTab key="audio" {...props} />}
      </div>
    </Modal>
  );
}
