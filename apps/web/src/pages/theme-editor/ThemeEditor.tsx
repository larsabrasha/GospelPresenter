import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { THEME_LIMITS, type Background, type TextStyle, type Theme, type ThemeDefinition } from '@gp/core';
import { getOwnTheme } from '../../db/queries.ts';
import { useData, useDb } from '../../db/react.tsx';
import { t, type TextKey } from '../../i18n.ts';
import { loadingText } from '../../ui/playful.ts';
import { AppButton } from '../../ui/AppButton.tsx';
import { useSavedIndicator, useTrySave } from '../../ui/AutoSave.tsx';
import { MENU_ITEM } from '../../ui/Dropdown.tsx';
import { NameDialog } from '../../ui/NameDialog.tsx';
import { usePhone } from '../../ui/usePhone.ts';
import { DetailHeader, PageContainer } from '../../ui/PageContainer.tsx';
import { href } from '../../ui/router.ts';
import { FormatButton, GROUP, FormatPanel, Segmented, STAYS, STAYS_ABOVE, UndoRedo, useWide } from '../custom-slides/EditorChrome.tsx';
import { FormatSheet } from '../custom-slides/FormatSheet.tsx';
import * as history from '../custom-slides/history.ts';
import { ImagePicker } from '../custom-slides/ImagePicker.tsx';
import { ThemeCanvas } from './ThemeCanvas.tsx';
import { ThemeInspector } from './ThemeInspector.tsx';
import { useJustCreated } from '../../ui/justCreated.ts';
import { withBackground, withText, type EditedKind, type TextRole } from './themeModel.ts';

// An own theme's editor (docs/themes.md), as the slideshows' and overlays' (Lars, 2026-11-26): Ångra and Gör om in a
// capsule above the slide, Format's brush at the right; Format a panel beside the slide where there is room, the slide
// narrower and never covered, else under it, or on a phone a sheet; the three kinds of slide (Sång, Bibeltext, Bild och
// video) a segmented control in the toolbar, as a macOS view's, where the eye already is: three pictures of black slides
// under it were not taken for a choice (Lars, 2026-11-26); on a phone a row of its own under the toolbar. The theme is renamed from its title's menu. A tap on a text picks it, as its row in
// Format's list of the parts does, to change its look and to drag or size its box. It saves as it goes, the whole
// definition, half a second after the last change.

const SAVE_AFTER_MS = 500;
const KINDS: [EditedKind, TextKey][] = [
  ['song', 'themeEditor.song'],
  ['bible', 'themeEditor.bible'],
  ['media', 'themeEditor.media'],
];

const typing = (e: ReactKeyboardEvent) => e.target instanceof HTMLElement && !!e.target.closest('input, textarea, select, [contenteditable]');

export function ThemeEditor({ id }: { id: string }) {
  const db = useDb();
  const trySave = useTrySave();
  const saved = useSavedIndicator();
  const row = useData((d) => getOwnTheme(d, id), [id]);
  const [h, setH] = useState<history.History<ThemeDefinition> | null>(null);
  const [kind, setKind] = useState<EditedKind>('song');
  const [picked, setPicked] = useState<TextRole | null>(null);
  // Just made: Format open with the name picked, where it is a popover or a sheet (ui/justCreated.ts).
  const isNew = useJustCreated(id);
  // Just made, the name is in Format to type at once, until a part is picked.
  const [naming, setNaming] = useState(isNew);
  const phone = usePhone();
  const column = useRef<HTMLDivElement>(null);
  const wide = useWide(column) && !phone;
  // Open on a computer until closed (beside the slide, or under it where narrow); on a phone only when asked for, or just made.
  const [formatChoice, setFormatOpen] = useState<boolean | null>(isNew ? true : null);
  const formatOpen = formatChoice ?? !phone;
  // Too narrow for Format beside the slide, and no phone: Format under it, never over it.
  const stacked = formatOpen && !wide && !phone;
  const [renaming, setRenaming] = useState(false);
  const [choosing, setChoosing] = useState(false);
  /** Changes not saved yet: while there are some, the theme as stored is not taken over. */
  const dirty = useRef(false);
  /** The newest version taken over or saved here. */
  const known = useRef(0);
  const definition = h?.present ?? null;

  // The stored theme, at first and whenever another device saved a newer one and nothing here waits to be saved.
  if (row && !dirty.current && row.updatedAt > known.current) {
    known.current = row.updatedAt;
    if (JSON.stringify(row.theme.definition) !== JSON.stringify(definition)) setH(history.startHistory(row.theme.definition));
  }
  const save = async (next: ThemeDefinition) => {
    dirty.current = false;
    const at = Math.max(Date.now(), known.current + 1);
    known.current = at;
    if (await trySave(db.mutate('updateTheme', { id, definition: next, at }))) saved.show();
  };
  useEffect(() => {
    if (!definition || !dirty.current) return;
    const timer = setTimeout(() => void save(definition), SAVE_AFTER_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- saved once the changes stop
  }, [definition]);
  // Leaving the page saves what waits at once.
  const pending = useRef(definition);
  useEffect(() => {
    pending.current = definition;
  });
  useEffect(
    () => () => {
      if (dirty.current && pending.current) void save(pending.current);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- on leaving only
    [],
  );

  if (!row || !definition || !h)
    return <PageContainer>{row === null ? <p className="px-5 text-stone-500">{t('themeEditor.missing')}</p> : <div className="loading-line px-5 text-stone-400">{loadingText()}</div>}</PageContainer>;

  const theme: Theme = { ...row.theme, definition };
  /** A change, kept for Ångra: `key` names its kind, so a slider pulled is one step; '' is always a step of its own. */
  const change = (key: string, fn: (d: ThemeDefinition) => ThemeDefinition) => {
    dirty.current = true;
    setH((now) => (now ? history.record(now, fn(now.present), key, Date.now()) : now));
  };
  const step = (fn: (h: history.History<ThemeDefinition>) => history.History<ThemeDefinition>) => {
    dirty.current = true;
    setH((now) => now && fn(now));
  };
  const onText = (key: string, patch: Partial<TextStyle>) => {
    if (kind === 'media' || !picked) return;
    change(key && `${kind}:${picked}:${key}`, (d) => withText(d, kind, picked, patch));
  };
  const onBackground = (key: string, patch: Partial<Background>) => change(key && `${kind}:background:${key}`, (d) => withBackground(d, kind, patch));
  const pickPart = (role: TextRole | null) => {
    setPicked(role);
    if (role) setNaming(false);
  };
  const open = (k: EditedKind) => {
    setKind(k);
    setPicked(null);
  };
  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (typing(e) || !(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
    e.preventDefault();
    step(e.shiftKey ? history.redo : history.undo);
  };

  const inspector = (
    <ThemeInspector
      name={row.theme.name}
      nameNew={naming}
      definition={definition}
      kind={kind}
      picked={picked}
      onRename={(name) => db.mutate('updateTheme', { id, name, at: Date.now() })}
      onSaved={saved.show}
      onText={onText}
      onBackground={onBackground}
      onChoosePicture={() => setChoosing(true)}
      onPick={pickPart}
    />
  );
  const undoRedo = <UndoRedo canUndo={!!h.past.length} canRedo={!!h.future.length} onUndo={() => step(history.undo)} onRedo={() => step(history.redo)} />;
  const formatButton = <FormatButton open={formatOpen} onToggle={() => setFormatOpen(!formatOpen)} />;
  const kinds = <Segmented label={t('themeEditor.kinds')} value={kind} choices={KINDS} onChange={open} />;

  return (
    <PageContainer maxWidthClass="max-w-[1400px]" className="pb-8">
      <DetailHeader
        backHref={href({ page: 'themes' })}
        title={row.theme.name}
        menu={
          <AppButton variant="plain" role="menuitem" className={MENU_ITEM} onClick={() => setRenaming(true)}>
            {t('slideEditor.rename')}
          </AppButton>
        }
        saved={saved.node}
        className="px-5"
      />
      <div ref={column} className="relative space-y-3" onKeyDown={onKeyDown}>
        {phone ? (
          <>
            <div className="flex justify-end" role="toolbar" aria-label={t('slideEditor.format')}>
              <div className={GROUP}>
                {undoRedo}
                {formatButton}
              </div>
            </div>
            {kinds}
          </>
        ) : (
          <div className="flex items-center gap-2" role="toolbar" aria-label={t('slideEditor.format')}>
            <div className={GROUP}>{undoRedo}</div>
            <div className="flex-1 min-w-0 flex justify-center">{kinds}</div>
            <div className={GROUP}>{formatButton}</div>
          </div>
        )}
        {formatOpen && phone && (
          <FormatSheet title={t('slideEditor.format')} hideFrom="" onClose={() => setFormatOpen(false)}>
            {inspector}
          </FormatSheet>
        )}
        <div className="flex gap-4 items-start">
          <div className={`flex-1 min-w-0 space-y-3 ${formatOpen && wide ? STAYS : ''}`}>
            <div className={stacked ? STAYS_ABOVE : ''}>
              <ThemeCanvas theme={theme} kind={kind} picked={picked} onPick={pickPart} onArea={(role, area, run) => kind !== 'media' && change(run ? `${kind}:${role}:area` : '', (d) => withText(d, kind, role, { area }))} />
            </div>
            {stacked && <FormatPanel beside={false}>{inspector}</FormatPanel>}
          </div>
          {formatOpen && wide && <FormatPanel beside>{inspector}</FormatPanel>}
        </div>
      </div>
      {renaming && (
        <NameDialog
          title={t('library.rename')}
          label={t('song.name')}
          maxChars={THEME_LIMITS.name}
          initial={row.theme.name}
          onClose={() => setRenaming(false)}
          submit={async (name) => {
            if (await trySave(db.mutate('updateTheme', { id, name, at: Date.now() }))) setRenaming(false);
          }}
        />
      )}
      {choosing && (
        <ImagePicker
          onClose={() => setChoosing(false)}
          onPick={(chosen) => {
            onBackground('', { image: { kind: 'picture', full: chosen.picture.full, thumb: chosen.picture.thumb } });
            setChoosing(false);
          }}
        />
      )}
    </PageContainer>
  );
}
