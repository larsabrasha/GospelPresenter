import { LIMITS, type Label, type SongPart } from '@gp/core';
import { useEffect, useEffectEvent, useRef, type ReactNode } from 'react';
import { useData, useDb } from '../db/react.tsx';
import { arrangementsOf, getSong, listLabels, presentationsUsing, songPartsOf } from '../db/queries.ts';
import { t } from '../i18n.ts';
import { newId } from '../ids.ts';
import { AppButton } from '../ui/AppButton.tsx';
import { AutoSaveField, useSaveFailed, useSavedIndicator } from '../ui/AutoSave.tsx';
import { afterWrite } from '../ui/debounce.ts';
import { deleteAsk, useConfirm } from '../ui/Dialog.tsx';
import { ChevronDownIcon, ChevronUpIcon, PlusIcon, TrashIcon } from '../ui/icons.tsx';
import { DANGER_ROW, Group, OpeningRow, TEXT_ACTION } from '../ui/Group.tsx';
import { MoreMenu } from '../ui/MoreMenu.tsx';
import { DetailHeader, PageContainer } from '../ui/PageContainer.tsx';
import { isAddKey } from '../ui/Picker.tsx';
import { SelectMenu } from '../ui/SelectMenu.tsx';
import { useToast } from '../ui/Toast.tsx';
import { href, navigate } from '../ui/router.ts';
import { ctrlLabel } from '../ui/shortcuts.ts';
import { SongMaterialsRow } from './song-materials/SongMaterials.tsx';
import { arrangementSummary } from './SongArrangements.tsx';
import { CARD, PILL } from './songEditorLook.ts';

// The song editor's look is Components/SongEditor.razor and the parts it is made of:
// SongFieldsEditor, SongPartsEditor and SongArrangementEditor.


/** A song just made in the add dialog: added, or thrown away (the song goes too). */
export interface NewSong {
  onAdd: (name: string) => void;
  onCancel: () => void;
  /** The name is a stand-in (nothing was searched for): start there rather than in the first part. */
  focusName: boolean;
}

/**
 * The song editor (spec 02, `/admin/songs/{id}`; Pages/Admin/SongDetail.razor), one page wherever a song is edited.
 * With `onBack`, inside the add dialog (EditSong.razor): its back button returns to the song list there, and
 * so does moving the song to the trash. With `adding`, a song just made there: Avbryt, "Ny sång"
 * and Lägg till (Ctrl+Enter) in place of the back button, and no Flytta till papperskorgen. There, Escape
 * is the back button, or Avbryt.
 */
export function SongEditor({ id, onBack, adding }: { id: string; onBack?: () => void; adding?: NewSong }) {
  const db = useDb();
  const toast = useToast();
  const { dialog, ask } = useConfirm();
  const saved = useSavedIndicator();
  const saveFailed = useSaveFailed();
  const data = useData(
    async (d) => ({
      song: await getSong(d, id),
      parts: await songPartsOf(d, [id]),
      arrangements: await arrangementsOf(d, [id]),
      labels: await listLabels(d),
    }),
    [id],
  );
  // "Lägg till del" brings the new part into view once it is there (SongEditor.razor's scrollToElement).
  const scrollTo = useRef<string | null>(null);
  useEffect(() => {
    if (!scrollTo.current) return;
    const target = document.querySelector(`[data-part-id="${CSS.escape(scrollTo.current)}"]`);
    if (!target) return;
    scrollTo.current = null;
    target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
  // A new song starts in its first part, or in its name when that is a stand-in.
  const focused = useRef(false);
  /** Something was typed in the editor (a new song's Avbryt asks then). */
  const typed = useRef(false);
  useEffect(() => {
    if (!adding || focused.current || !data?.song) return;
    focused.current = true;
    document.querySelector<HTMLElement>(adding.focusName ? `[data-song-name] input` : `[data-part-id] textarea`)?.focus();
  });
  const addKey = useEffectEvent((e: KeyboardEvent) => {
    if (!adding || !data?.song || !isAddKey(e)) return;
    e.preventDefault();
    adding.onAdd(data.song.name);
  });
  useEffect(() => {
    if (!adding) return;
    addEventListener('keydown', addKey, true);
    return () => removeEventListener('keydown', addKey, true);
  }, [adding]);
  // A song that is not there (gone, or in the trash) sends back to the list (SongDetail.razor).
  const missing = !!data && (!data.song || data.song.deletedAt !== null);
  const leave = useEffectEvent(() => (onBack ? onBack() : navigate({ page: 'songs' })));
  useEffect(() => {
    if (missing) leave();
  }, [missing]);
  const back = onBack ? { onBack } : { backHref: href({ page: 'songs' }) };
  if (!data)
    return (
      <Frame onEscape={adding?.onCancel ?? onBack}>
        <DetailHeader {...back} title="" className="px-5" />
        <div className="loading-line px-7 text-stone-400">{t('common.loading')}</div>
      </Frame>
    );
  const { song, parts, arrangements, labels } = data;
  if (!song || song.deletedAt !== null) return null;

  const update = (fields: Record<string, string | number | null>) => db.mutate('updateSong', { id, ...fields });
  // "Sparad" after the writes the current app flags: fields, a part's text and label, and arrangements;
  // "Kunde inte spara" when one of them is refused.
  const saving = (write: Promise<void>) => afterWrite(write, saved.show, saveFailed);
  // The writes it does not flag ("Sparad") still say when they are refused.
  const failing = (write: Promise<void>) => afterWrite(write, () => {}, saveFailed);
  // The organisation's labels in their order (SONG-R45); the server writes the defaults (SONG-R47).
  const labelChoices: Label[] = [...labels.values()];

  const removePart = async (p: SongPart) => {
    const label = p.labelId ? (labels.get(p.labelId)?.text ?? t('song.noLabel')) : t('song.noLabel');
    await ask(deleteAsk(t('song.removePartConfirm', { label }), label, async () => failing(db.mutate('removeSongPart', { id: p.id }))));
  };

  const trash = async () => {
    // D17: say where the song is used before it goes.
    const using = await presentationsUsing(db, id);
    const text = [t('song.trashConfirm', { name: song.name }), using.length ? t('song.usedIn', { names: using.map((p) => p.name).join(', ') }) : ''].filter(Boolean).join(' ');
    if (!(await ask({ title: t('common.delete'), text, bold: song.name, confirm: t('common.delete') }))) return;
    try {
      await db.mutate('trashSong', { id, at: Date.now() });
    } catch (e) {
      // Refused: the song stays, and so does the page.
      console.error('save failed', e);
      saveFailed();
      return;
    }
    toast(t('song.trashed', { name: song.name }));
    if (onBack) onBack();
    else navigate({ page: 'songs' });
  };

  const partRow = (p: SongPart, i: number) => {
    const label = p.labelId ? labelChoices.find((l) => l.id === p.labelId) : undefined;
    return (
      // A part as a group (Lars, 2026-11-02, as Apple would): its label over the card, with ⋯ for moving and removing it,
      // and the card holding its text alone.
      <li key={p.id} data-part-id={p.id} className="space-y-1">
        <div className="flex items-center gap-1 px-2">
          <SelectMenu
            label={t('song.label')}
            value={p.labelId ?? ''}
            choices={[
              { value: '', label: t('song.noLabel'), content: <span className="text-stone-400">{t('song.noLabel')}</span> },
              ...labelChoices.map((l) => ({
                value: l.id,
                label: l.text,
                content: (
                  <span className={PILL} style={{ background: l.color }}>
                    {l.text}
                  </span>
                ),
              })),
            ]}
            onChoose={(v) => saving(db.mutate('updateSongPart', { id: p.id, labelText: labelChoices.find((l) => l.id === v)?.text ?? null }))}
            buttonClassName="flex items-center gap-1.5 rounded-full px-2 py-1 text-sm text-left text-stone-900 dark:text-stone-100 hover:bg-stone-200/60 dark:hover:bg-white/[0.06] cursor-pointer focus-visible:ring-2 focus-visible:ring-sky-500 outline-none"
            listClassName="left-0 w-56 max-h-60 overflow-y-auto"
            face={
              <>
                {label ? (
                  <>
                    <span className={`${PILL} shrink-0`} style={{ background: label.color }}>
                      {label.text}
                    </span>
                  </>
                ) : (
                  <span className="truncate text-stone-400">{t('song.noLabel')}</span>
                )}
                <ChevronDownIcon className="size-4 text-stone-400 shrink-0" />
              </>
            }
          />
          <div className="flex-1" />
          <MoreMenu
            name={label?.text ?? `${t('song.parts')} ${i + 1}`}
            choices={[
              { label: t('common.moveUp'), icon: <ChevronUpIcon className="size-4" />, disabled: i === 0, onChoose: () => failing(db.mutate('moveSongPart', { id: p.id, toIndex: i - 1 })) },
              { label: t('common.moveDown'), icon: <ChevronDownIcon className="size-4" />, disabled: i === parts.length - 1, onChoose: () => failing(db.mutate('moveSongPart', { id: p.id, toIndex: i + 1 })) },
              { label: t('song.removePart'), icon: <TrashIcon className="size-4" />, danger: true, onChoose: () => void removePart(p) },
            ]}
          />
        </div>
        <div className={`${CARD} overflow-hidden`}>
        <AutoSaveField
          label={`${t('song.parts')} ${i + 1}`}
          value={p.content}
          maxLength={5000}
          multiline
          bare
          warnOnClash
          onSave={(content) => db.mutate('updateSongPart', { id: p.id, content })}
          onSaved={saved.show}
        />
        </div>
      </li>
    );
  };

  // What was typed is asked about before it goes, saved yet or not; an untouched new song just goes.
  const cancel = async () => {
    if (!adding) return;
    if (typed.current && !(await ask({ title: t('song.discardTitle'), text: t('song.discardText'), confirm: t('song.discard') }))) return;
    adding.onCancel();
  };

  return (
    <Frame
      onEscape={adding ? () => void cancel() : onBack}
      bar={
        adding ? (
          // The dialog's one bar while a song is made in it, as iOS's sheet: Avbryt, the name in the middle, Lägg till.
          <div className="relative flex items-center justify-between gap-3 h-14 shrink-0 px-4">
            <AppButton variant="cancel" onClick={() => void cancel()}>
              {t('common.cancel')}
            </AppButton>
            <h1 className="absolute left-1/2 -translate-x-1/2 max-w-[40%] truncate font-semibold text-[17px] dark:text-stone-100">{t('song.newTitle')}</h1>
            <div className="flex items-center gap-3">
              <span className="relative w-16 h-5">{saved.node}</span>
              <AppButton title={ctrlLabel('Enter')} onClick={() => adding.onAdd(song.name)}>
                {t('presentation.add')}
              </AppButton>
            </div>
          </div>
        ) : (
          onBack && <DetailHeader onBack={onBack} title={song.name} saved={saved.node} className="h-14 shrink-0 px-4" />
        )
      }
    >
      {dialog}
      {!adding && !onBack && <DetailHeader {...back} title={song.name} saved={saved.node} className="px-5" />}
      <div className="space-y-4" onInput={() => (typed.current = true)}>
        {/* The song's facts as one card of rows, none side by side, each a field whose name moves up as it is typed in
            (Lars, 2026-11-02). */}
        <Group>
          {/* A blank name is not saved (spec 02). */}
          <div data-song-name>
            <AutoSaveField bare label={t('song.name')} maxLength={200} value={song.name} onSave={(v) => (v.trim() ? update({ name: v }) : undefined)} onSaved={saved.show} />
          </div>
          <AutoSaveField bare label={t('song.author')} maxLength={200} value={song.author ?? ''} onSave={(v) => update({ author: v })} onSaved={saved.show} />
          <AutoSaveField bare label={t('song.publisher')} maxLength={200} value={song.publisher ?? ''} onSave={(v) => update({ publisher: v })} onSaved={saved.show} />
          <AutoSaveField
            bare
            label={t('song.year')}
            type="number"
            min={0}
            max={9999}
            value={song.year === null ? '' : String(song.year)}
            onSave={(v) => {
              const year = v.trim() === '' ? null : Number(v);
              return year === null || (Number.isInteger(year) && year >= 0 && year <= 9999) ? update({ year }) : undefined;
            }}
            onSaved={saved.show}
          />
          <AutoSaveField bare label={t('song.ccli')} maxLength={20} value={song.ccli ?? ''} onSave={(v) => update({ ccli: v })} onSaved={saved.show} />
        </Group>
        {/* The current app shows no heading over the parts; this one is for screen readers. */}
        <h2 className="sr-only">{t('song.parts')}</h2>
        <ol className="space-y-4">{parts.map(partRow)}</ol>
        <AppButton
          variant="plain"
          className={`${TEXT_ACTION} -mt-2`}
          disabled={parts.length >= LIMITS.partsPerSong}
          onClick={() => {
            const partId = newId();
            scrollTo.current = partId;
            failing(db.mutate('addSongPart', { id: partId, songId: id, labelText: null, content: '' }));
          }}
        >
          <PlusIcon className="size-4" />
          {t('song.addPart')}
        </AppButton>
        {/* What is done to a song less often, as rows that push a page in, as iOS's Settings (Lars, 2026-11-03): its
            arrangements, its sheet music and links, its history; then Ta bort sång as a red row of its own. A song just
            made in the add dialog has none of them: a page pushed in would leave the dialog. */}
        {!adding && (
          <Group>
            {!!parts.length && <OpeningRow label={t('song.arrangements')} value={arrangementSummary(arrangements, parts, labels)} href={href({ page: 'songArrangements', id })} />}
            <SongMaterialsRow songId={id} />
            <OpeningRow label={t('song.history')} href={href({ page: 'songHistory', id })} />
          </Group>
        )}
        {!adding && (
          <Group>
            <AppButton variant="plain" className={DANGER_ROW} onClick={() => void trash()}>
              {t('song.trash')}
            </AppButton>
          </Group>
        )}
      </div>
    </Frame>
  );
}

/**
 * The song's page, the same in Inställningar and in the add dialog (Lars, 2026-11-02: one song editor). In the add
 * dialog (`onEscape`) Escape goes back one step, to the song list; a second one closes the dialog. A menu or question
 * open in the editor takes its own Escape first.
 */
function Frame({ children, bar, onEscape }: { children: ReactNode; /** A bar over the page that stays while it scrolls: the add dialog's. */ bar?: ReactNode; onEscape?: () => void }) {
  return (
    <div
      className="contents"
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || !onEscape) return;
        e.stopPropagation();
        onEscape();
      }}
    >
      {bar}
      <PageContainer className="pb-8">{children}</PageContainer>
    </div>
  );
}
