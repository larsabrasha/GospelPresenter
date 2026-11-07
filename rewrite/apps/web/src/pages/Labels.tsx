import { useId, useRef, useState } from 'react';
import { DEFAULT_LABEL_COLOR, labelKey, type Label } from '@gp/core';
import { listLabels } from '../db/queries.ts';
import { useData, useDb } from '../db/react.tsx';
import { t } from '../i18n.ts';
import { AddButton } from '../ui/AddButton.tsx';
import { AppButton } from '../ui/AppButton.tsx';
import { useTrySave } from '../ui/AutoSave.tsx';
import { deleteAsk, Dialog, DialogButtons, useConfirm } from '../ui/Dialog.tsx';
import { EmptyPicture, PICTURE } from '../ui/Empty.tsx';
import { FloatingInput } from '../ui/Floating.tsx';
import { DANGER_ROW, Group } from '../ui/Group.tsx';
import { CheckIcon, GripIcon, LabelsPicture } from '../ui/icons.tsx';
import { CARD, ROW_HOVER, RowChevron } from '../ui/List.tsx';
import { PageContainer, PageHeader } from '../ui/PageContainer.tsx';
import { SelectButtons, SelectionBar, Tick, useSelection } from '../ui/Selecting.tsx';
import { useSortable } from '../ui/sortable.ts';
import { useToast } from '../ui/Toast.tsx';
import { PILL } from './songEditorLook.ts';

// Etiketter (spec 02 `/admin/labels`, SONG-R45–R47) as iOS's Reminders lists its lists (Lars, 2026-11-04): a row a
// label, drawn as the pill it is where it is used, so it is known again; a tap opens a sheet with its name, its
// colour as a grid of swatches, and Radera; Välj, as every list has it (Lars, 2026-11-07), ticks labels to delete
// together and has the rows dragged into order.

/** The labels in their order (SONG-R45), as the song editor lists them. */
const ordered = async (db: Parameters<typeof listLabels>[0]) => [...(await listLabels(db)).values()];

/** The swatches of the sheet, as Reminders' colours; a label's own colour that is none of them is kept as the last. */
const SWATCHES = ['#dc2626', '#ea580c', '#d97706', '#ca8a04', '#16a34a', '#0d9488', '#0284c7', '#2563eb', '#4f46e5', '#9333ea', '#db2777', DEFAULT_LABEL_COLOR];

/** A label as a part's pill draws it (PartPill). */
const Pill = ({ label }: { label: Label }) => (
  <span className={`${PILL} min-w-0 truncate`} style={{ background: label.color }}>
    {label.text}
  </span>
);

/**
 * "Ny etikett" or "Redigera etikett": the text, the colour, and a label being edited has Radera. Ctrl+Enter saves and
 * closes; Shift+Enter, when creating, creates and empties the field for the next (SONG-A28). A text another label
 * has is said at once.
 */
function LabelSheet({ editing, labels, onRemove, onClose }: { editing: Label | null; labels: Label[]; onRemove: (l: Label) => void; onClose: () => void }) {
  const db = useDb();
  const trySave = useTrySave();
  const toast = useToast();
  const [text, setText] = useState(editing?.text ?? '');
  const [color, setColor] = useState(editing?.color ?? DEFAULT_LABEL_COLOR);
  const [saving, setSaving] = useState(false);
  const inputId = useId();
  const taken = !!text.trim() && labels.some((l) => l.id !== editing?.id && labelKey(l.text) === labelKey(text));
  const canSave = !!text.trim() && !taken && !saving;
  const swatches = SWATCHES.includes(color.toLowerCase()) ? SWATCHES : [...SWATCHES, color];

  const save = async (keepOpen: boolean) => {
    if (!canSave) return;
    setSaving(true);
    const write = editing ? db.mutate('updateLabel', { id: editing.id, text: text.trim(), color }) : db.mutate('createLabel', { text: text.trim(), color });
    const ok = await trySave(write);
    setSaving(false);
    if (!ok) return;
    if (!keepOpen) return onClose();
    toast(t('labels.created'));
    setText('');
    document.getElementById(inputId)?.focus();
  };

  return (
    <Dialog title={editing ? t('labels.editTitle') : t('labels.addTitle')} onClose={onClose} maxWidthClass="max-w-lg">
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          void save(false);
        }}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            void save(false);
          } else if (e.shiftKey && !editing) {
            e.preventDefault();
            void save(true);
          }
        }}
      >
        {/* The label as it is drawn where it is used. */}
        <div className="flex justify-center">
          <span className={`${PILL} max-w-full truncate`} style={{ background: color }}>
            {text.trim() || t('labels.field')}
          </span>
        </div>
        <div className="space-y-1">
          <FloatingInput id={inputId} label={t('labels.field')} hideLabel autoFocus maxLength={50} value={text} hasError={taken} onChange={(e) => setText(e.target.value)} />
          {taken && <p className="text-sm text-red-600 dark:text-red-400">{t('labels.taken')}</p>}
        </div>
        <div role="radiogroup" aria-label={t('labels.color')} className="grid grid-cols-6 gap-3 justify-items-center">
          {swatches.map((c) => (
            <AppButton
              key={c}
              variant="plain"
              role="radio"
              aria-checked={color.toLowerCase() === c.toLowerCase()}
              aria-label={c}
              className="size-10 rounded-full flex items-center justify-center cursor-pointer ring-offset-2 ring-offset-surface aria-checked:ring-2 aria-checked:ring-stone-400 dark:aria-checked:ring-stone-500"
              style={{ backgroundColor: c }}
              onClick={() => setColor(c)}
            >
              {color.toLowerCase() === c.toLowerCase() && <CheckIcon className="size-5 text-white" />}
            </AppButton>
          ))}
          {/* Any other colour, as Reminders' last swatch. */}
          <label className="size-10 rounded-full cursor-pointer bg-[conic-gradient(#ef4444,#eab308,#22c55e,#06b6d4,#3b82f6,#a855f7,#ef4444)]" title={t('labels.otherColor')}>
            <input type="color" className="sr-only" aria-label={t('labels.otherColor')} value={color} onChange={(e) => setColor(e.target.value)} />
          </label>
        </div>
        {editing && (
          <Group>
            <AppButton variant="plain" className={DANGER_ROW} onClick={() => onRemove(editing)}>
              {t('labels.deleteOne')}
            </AppButton>
          </Group>
        )}
        <DialogButtons>
          <AppButton variant="cancel" onClick={onClose}>
            {t('common.cancel')}
          </AppButton>
          <AppButton type="submit" disabled={!canSave} loading={saving} title={editing ? 'Ctrl+Enter' : 'Ctrl+Enter, Shift+Enter'}>
            {editing ? t('common.save') : t('common.create')}
          </AppButton>
        </DialogButtons>
      </form>
    </Dialog>
  );
}

/** Etiketter: the part labels, in order, to create, edit, reorder and remove. */
export function Labels() {
  const db = useDb();
  const trySave = useTrySave();
  const { dialog, ask } = useConfirm();
  const labels = useData(ordered, []);
  const [editing, setEditing] = useState<Label | 'new' | null>(null);
  const selection = useSelection();
  const refocus = useRef<string | null>(null);

  const move = (from: number, to: number) => {
    const l = labels?.[from];
    if (!l || to < 0 || to >= labels.length || to === from) return;
    refocus.current = l.id;
    void trySave(db.mutate('moveLabel', { id: l.id, toIndex: to }));
  };
  const { listRef, rowStyle, handle, wholeRow, dragging } = useSortable<HTMLUListElement>(move);
  const remove = async (l: Label) => {
    if (await ask(deleteAsk(t('labels.deleteConfirm', { text: l.text }), l.text, () => trySave(db.mutate('deleteLabel', { id: l.id }))))) setEditing(null);
  };
  const picked = labels?.filter((l) => selection.picked.has(l.id)) ?? [];
  const removePicked = async () => {
    const [one] = picked;
    if (!one) return;
    const question = picked.length === 1 ? deleteAsk(t('labels.deleteConfirm', { text: one.text }), one.text, () => trySave(db.mutate('deleteLabel', { id: one.id }))) : deleteAsk(t('labels.deleteMany', { n: picked.length }), undefined, async () => void (await Promise.all(picked.map((l) => trySave(db.mutate('deleteLabel', { id: l.id }))))));
    if (await ask(question)) selection.stop();
  };

  return (
    <PageContainer>
      {/* Escape ends Välj, and only that; the toolbar floats elsewhere, but its events come here through React. */}
      <div className="flex flex-col space-y-5" onKeyDown={selection.escape}>
        {dialog}
        <PageHeader title={t('labels.title')}>
          {selection.selecting ? (
            <SelectionBar count={picked.length}>
              <AppButton variant="danger" filled disabled={!picked.length} onClick={() => void removePicked()}>
                {t('common.delete')}
              </AppButton>
            </SelectionBar>
          ) : (
            !!labels?.length && <AddButton label={t('common.create')} onClick={() => setEditing('new')} />
          )}
        </PageHeader>
        {!labels && <div className="loading-line px-7 py-4 text-stone-400">{t('common.loading')}</div>}
        {labels && !labels.length && (
          <div className={CARD}>
            <EmptyPicture picture={<LabelsPicture className={PICTURE} />} title={t('labels.empty')}>
              <AppButton onClick={() => setEditing('new')}>{t('labels.addTitle')}</AppButton>
            </EmptyPicture>
          </div>
        )}
        {!!labels?.length && (
          // As Välj over a library: its own row, its hover clear of the list (Lars, 2026-11-04).
          <div className="flex justify-end -mt-3 mb-2">
            <SelectButtons selection={selection} ids={labels.map((l) => l.id)} />
          </div>
        )}
        {!!labels?.length && (
          <ul ref={listRef} aria-label={t('labels.title')} className="flex flex-col rounded-xl [&>li+li]:border-t-[0.5px] [&>li+li]:border-separator">
            {labels.map((l, i) =>
              selection.selecting ? (
                // A tap ticks it; a mouse drags the row, a finger its grip; with focus on it, Alt+↑/↓ moves it, as an
                // arrangement's parts.
                <li
                  key={l.id}
                  aria-label={l.text}
                  data-sort-row
                  ref={(el) => {
                    if (el && refocus.current === l.id) {
                      refocus.current = null;
                      el.querySelector('button')?.focus();
                    }
                  }}
                  style={rowStyle(i)}
                  {...wholeRow(i)}
                  onKeyDown={(e) => {
                    if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
                    e.preventDefault();
                    move(i, e.key === 'ArrowUp' ? i - 1 : i + 1);
                  }}
                  className={`flex items-center bg-surface select-none [-webkit-touch-callout:none] first:rounded-t-xl last:rounded-b-xl ${ROW_HOVER} ${dragging === i ? 'shadow-lg' : ''}`}
                >
                  <AppButton
                    variant="plain"
                    role="checkbox"
                    aria-checked={selection.picked.has(l.id)}
                    aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                    className="flex-1 min-w-0 flex items-center gap-3 pl-4 min-h-11 text-left cursor-pointer rounded-[inherit]"
                    onClick={(e) => selection.toggle(l.id, e, labels.map((each) => each.id))}
                  >
                    <Tick on={selection.picked.has(l.id)} />
                    <Pill label={l} />
                  </AppButton>
                  <span className="shrink-0 self-stretch flex items-center px-4 cursor-grab active:cursor-grabbing touch-none" aria-hidden="true" {...handle(i)}>
                    <GripIcon className="size-4 text-stone-300 dark:text-stone-500" />
                  </span>
                </li>
              ) : (
                <li key={l.id} aria-label={l.text} className="bg-surface first:rounded-t-xl last:rounded-b-xl">
                  <AppButton
                    variant="plain"
                    aria-label={t('labels.edit', { text: l.text })}
                    className="flex items-center gap-3 w-full px-4 min-h-11 text-left cursor-pointer rounded-[inherit] hover:bg-stone-200/60 dark:hover:bg-white/[0.06]"
                    onClick={() => setEditing(l)}
                  >
                    <Pill label={l} />
                    <span className="flex-1" />
                    <RowChevron />
                  </AppButton>
                </li>
              ),
            )}
          </ul>
        )}
        {editing && <LabelSheet editing={editing === 'new' ? null : editing} labels={labels ?? []} onRemove={(l) => void remove(l)} onClose={() => setEditing(null)} />}
      </div>
    </PageContainer>
  );
}
