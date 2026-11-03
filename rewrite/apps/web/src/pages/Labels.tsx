import { useId, useState } from 'react';
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
import { ChevronDownIcon, ChevronUpIcon, LabelsPicture, PencilIcon, TrashIcon } from '../ui/icons.tsx';
import { CARD } from '../ui/List.tsx';
import { PageContainer, PageHeader } from '../ui/PageContainer.tsx';
import { useToast } from '../ui/Toast.tsx';

/** The labels in their order (SONG-R45), as the song editor lists them. */
const ordered = async (db: Parameters<typeof listLabels>[0]) => [...(await listLabels(db)).values()];

/**
 * "Skapa etikett" or "Redigera etikett" (Labels.razor): the text and a colour.
 * Ctrl+Enter saves and closes; Shift+Enter, when creating, creates and empties
 * the field for the next (SONG-A28). A text another label has is said at once.
 */
function LabelDialog({ editing, labels, onClose }: { editing: Label | null; labels: Label[]; onClose: () => void }) {
  const db = useDb();
  const trySave = useTrySave();
  const toast = useToast();
  const [text, setText] = useState(editing?.text ?? '');
  const [color, setColor] = useState(editing?.color ?? DEFAULT_LABEL_COLOR);
  const [saving, setSaving] = useState(false);
  const inputId = useId();
  const taken = !!text.trim() && labels.some((l) => l.id !== editing?.id && labelKey(l.text) === labelKey(text));
  const canSave = !!text.trim() && !taken && !saving;

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
        className="space-y-4"
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
        <div className="space-y-1">
          <FloatingInput id={inputId} label={t('labels.field')} autoFocus maxLength={50} value={text} hasError={taken} onChange={(e) => setText(e.target.value)} />
          {taken && <p className="text-sm text-red-600 dark:text-red-400">{t('labels.taken')}</p>}
        </div>
        <label className="block">
          <span className="text-sm text-stone-500 dark:text-stone-400 mb-1 block">{t('labels.color')}</span>
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="block w-full h-10 rounded-lg border border-stone-300 dark:border-stone-600 cursor-pointer bg-transparent [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:border-0 [&::-webkit-color-swatch]:rounded-lg"
          />
        </label>
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

/** Etiketter (spec 02 `/admin/labels`; Labels.razor): the part labels, in order, to create, edit, move and delete. */
export function Labels() {
  const db = useDb();
  const trySave = useTrySave();
  const { dialog, ask } = useConfirm();
  const labels = useData(ordered, []);
  const [editing, setEditing] = useState<Label | 'new' | null>(null);

  const move = (l: Label, toIndex: number) => void trySave(db.mutate('moveLabel', { id: l.id, toIndex }));
  const remove = (l: Label) => void ask(deleteAsk(t('labels.deleteConfirm', { text: l.text }), l.text, () => trySave(db.mutate('deleteLabel', { id: l.id }))));
  return (
    <PageContainer>
      {dialog}
      <PageHeader title={t('labels.title')}>
        <AddButton label={t('common.create')} onClick={() => setEditing('new')} />
      </PageHeader>
      <div className={CARD}>
        {!labels && <div className="loading-line px-7 py-4 text-stone-400">{t('common.loading')}</div>}
        {labels && !labels.length && (
          <EmptyPicture picture={<LabelsPicture className={PICTURE} />} title={t('labels.empty')} />
        )}
        <ul aria-label={t('labels.title')}>
          {labels?.map((l, i) => (
            <li key={l.id} aria-label={l.text} className="flex items-center gap-3 px-7 py-3 border-b border-separator last:border-b-0">
              <span className="min-w-0 truncate rounded-full px-3 py-1 text-sm font-semibold text-white" style={{ backgroundColor: l.color }}>
                {l.text}
              </span>
              <div className="flex-1" />
              <div className="flex items-center gap-1">
                <AppButton variant="icon" disabled={i === 0} aria-label={t('labels.up', { text: l.text })} onClick={() => move(l, i - 1)}>
                  <ChevronUpIcon className="size-4" />
                </AppButton>
                <AppButton variant="icon" disabled={i === labels.length - 1} aria-label={t('labels.down', { text: l.text })} onClick={() => move(l, i + 1)}>
                  <ChevronDownIcon className="size-4" />
                </AppButton>
              </div>
              <AppButton variant="icon" aria-label={t('labels.edit', { text: l.text })} onClick={() => setEditing(l)}>
                <PencilIcon className="size-4" />
              </AppButton>
              <AppButton variant="dangerIcon" aria-label={t('labels.delete', { text: l.text })} onClick={() => remove(l)}>
                <TrashIcon className="size-4" />
              </AppButton>
            </li>
          ))}
        </ul>
      </div>
      {editing && <LabelDialog editing={editing === 'new' ? null : editing} labels={labels ?? []} onClose={() => setEditing(null)} />}
    </PageContainer>
  );
}
