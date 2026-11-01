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
import { ChevronDownIcon, ChevronUpIcon, ClockIcon, PlusIcon, TrashIcon } from '../ui/icons.tsx';
import { DetailHeader, PageContainer } from '../ui/PageContainer.tsx';
import { isAddKey } from '../ui/Picker.tsx';
import { SelectMenu } from '../ui/SelectMenu.tsx';
import { useToast } from '../ui/Toast.tsx';
import { href, navigate } from '../ui/router.ts';
import { ctrlLabel } from '../ui/shortcuts.ts';
import { SongMaterials } from './song-materials/SongMaterials.tsx';
import { ArrangementCard } from './ArrangementCard.tsx';
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
 * The song editor (spec 02, `/admin/songs/{id}`; Pages/Admin/SongDetail.razor). With `onBack`,
 * inside the add dialog (EditSong.razor): its back button returns to the song list there, and
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
  const Frame = onBack ? EmbeddedFrame : PageFrame;
  const back = onBack ? { onBack } : { backHref: href({ page: 'songs' }) };
  if (!data)
    return (
      <Frame onEscape={adding?.onCancel ?? onBack}>
        <DetailHeader {...back} title="" className={onBack ? 'shrink-0' : 'px-5'} />
        <div className="px-7 text-neutral-400">{t('common.loading')}</div>
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
      <li key={p.id} data-part-id={p.id} className={`${CARD} p-4 space-y-3`}>
        <div className="flex items-center gap-2">
          <SelectMenu
            label={t('song.label')}
            value={p.labelId ?? ''}
            choices={[
              { value: '', label: t('song.noLabel'), content: <span className="text-neutral-400">{t('song.noLabel')}</span> },
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
            className="flex-1 max-w-[50%]"
            buttonClassName="w-full flex items-center gap-2 rounded-lg border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-raised text-neutral-900 dark:text-neutral-100 px-3 py-2.5 text-sm text-left cursor-pointer focus:ring-2 focus:ring-sky-500 focus:border-sky-500 outline-none"
            listClassName="left-0 w-full max-h-60 overflow-y-auto"
            face={
              <>
                {label ? (
                  <>
                    <span className={`${PILL} shrink-0`} style={{ background: label.color }}>
                      {label.text}
                    </span>
                    <span className="flex-1" />
                  </>
                ) : (
                  <span className="flex-1 truncate text-neutral-400">{t('song.noLabel')}</span>
                )}
                <ChevronDownIcon className="size-4 text-neutral-400 shrink-0" />
              </>
            }
          />
          <div className="flex-1" />
          <div className="flex items-center gap-1">
            <AppButton
              variant="icon"
              className="p-1.5 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 disabled:cursor-default"
              aria-label={t('common.moveUp')}
              title={t('common.moveUp')}
              disabled={i === 0}
              onClick={() => failing(db.mutate('moveSongPart', { id: p.id, toIndex: i - 1 }))}
            >
              <ChevronUpIcon className="size-4" />
            </AppButton>
            <AppButton
              variant="icon"
              className="p-1.5 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 disabled:cursor-default"
              aria-label={t('common.moveDown')}
              title={t('common.moveDown')}
              disabled={i === parts.length - 1}
              onClick={() => failing(db.mutate('moveSongPart', { id: p.id, toIndex: i + 1 }))}
            >
              <ChevronDownIcon className="size-4" />
            </AppButton>
          </div>
        </div>
        <AutoSaveField
          label={`${t('song.parts')} ${i + 1}`}
          value={p.content}
          maxLength={5000}
          multiline
          warnOnClash
          onSave={(content) => db.mutate('updateSongPart', { id: p.id, content })}
          onSaved={saved.show}
        />
        <div className="flex justify-end">
          <AppButton variant="dangerIcon" className="p-1.5" aria-label={t('song.removePart')} title={t('song.removePart')} onClick={() => void removePart(p)}>
            <TrashIcon className="size-4" />
          </AppButton>
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
    <Frame onEscape={adding ? () => void cancel() : onBack}>
      {dialog}
      {adding ? (
        <div className="flex items-center justify-between gap-3 min-h-10 shrink-0">
          <AppButton variant="cancel" onClick={() => void cancel()}>
            {t('common.cancel')}
          </AppButton>
          <h1 className="text-xl/7 font-bold dark:text-neutral-100 truncate">{t('song.newTitle')}</h1>
          <div className="flex items-center gap-3">
            <span className="relative w-16 h-5">{saved.node}</span>
            <AppButton title={ctrlLabel('Enter')} onClick={() => adding.onAdd(song.name)}>
              {t('presentation.add')}
            </AppButton>
          </div>
        </div>
      ) : (
        <DetailHeader {...back} title={song.name} saved={saved.node} className={onBack ? 'shrink-0' : 'px-5'} />
      )}
      <div className="space-y-4" onInput={() => (typed.current = true)}>
        <div className={`${CARD} p-5 space-y-4`}>
          {/* A blank name is not saved (spec 02). */}
          <div data-song-name>
            <AutoSaveField label={t('song.name')} maxLength={200} value={song.name} onSave={(v) => (v.trim() ? update({ name: v }) : undefined)} onSaved={saved.show} />
          </div>
          <div className="flex gap-4">
            <AutoSaveField label={t('song.author')} maxLength={200} value={song.author ?? ''} onSave={(v) => update({ author: v })} onSaved={saved.show} className="flex-1" />
            <AutoSaveField
              label={t('song.publisher')}
              maxLength={200}
              value={song.publisher ?? ''}
              onSave={(v) => update({ publisher: v })}
              onSaved={saved.show}
              className="flex-1"
            />
          </div>
          <div className="flex gap-4">
            <AutoSaveField
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
              className="flex-1"
            />
            <AutoSaveField label={t('song.ccli')} maxLength={20} value={song.ccli ?? ''} onSave={(v) => update({ ccli: v })} onSaved={saved.show} className="flex-1" />
          </div>
        </div>
        {/* The current app shows no heading over the parts; this one is for screen readers. */}
        <h2 className="sr-only">{t('song.parts')}</h2>
        <ol className="space-y-4">{parts.map(partRow)}</ol>
        <AppButton
          variant="secondary"
          className="flex items-center gap-1.5 self-start"
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
        <div className="pt-4">
          <h2 className="text-lg font-bold text-neutral-800 dark:text-neutral-100 pb-3">{t('song.arrangements')}</h2>
          <div className="space-y-4">
            {arrangements.length > 0 && (
              <ol className="space-y-4">
                {arrangements.map((a, i) => (
                  <ArrangementCard key={a.id} arrangement={a} index={i} named={arrangements.length >= 2} parts={parts} labels={labels} saving={saving} showSaved={saved.show} />
                ))}
              </ol>
            )}
            {arrangements.length < LIMITS.arrangementsPerSong && (
              <AppButton
                variant="secondary"
                className="flex items-center gap-1.5 self-start"
                onClick={() => saving(db.mutate('createArrangement', { id: newId(), songId: id, partIds: parts.map((p) => p.id) }))}
              >
                <PlusIcon className="size-4" />
                {t('song.createArrangement')}
              </AppButton>
            )}
          </div>
        </div>
        {/* Noter och länkar for the band: on the song's page, not in the add dialog. */}
        {!adding && <SongMaterials songId={id} />}
        {!adding && (
          <div className="flex items-center justify-between">
            {/* Historik is the song page's, not the add dialog's (SongDetail.razor). */}
            {onBack ? (
              <div />
            ) : (
              <AppButton variant="neutral" href={href({ page: 'songHistory', id })} className="flex items-center gap-1.5">
                <ClockIcon className="size-4" strokeWidth={2} />
                {t('song.history')}
              </AppButton>
            )}
            <AppButton variant="danger" onClick={() => void trash()}>
              {t('song.trash')}
            </AppButton>
          </div>
        )}
      </div>
    </Frame>
  );
}

function PageFrame({ children }: { children: ReactNode; onEscape?: () => void }) {
  return <PageContainer className="pb-8">{children}</PageContainer>;
}

/** Inside the add dialog: its own scrolling column, with the dialog's padding (EditSong.razor). */
function EmbeddedFrame({ children, onEscape }: { children: ReactNode; onEscape?: () => void }) {
  return (
    <div
      className="flex-1 min-h-0 overflow-y-auto flex flex-col space-y-5 pb-6"
      onKeyDown={(e) => {
        // Escape goes back one step, to the song list; a second one closes the add dialog. A menu or question
        // open in the editor takes its own Escape first.
        if (e.key !== 'Escape' || !onEscape) return;
        e.stopPropagation();
        onEscape();
      }}
    >
      {children}
    </div>
  );
}
