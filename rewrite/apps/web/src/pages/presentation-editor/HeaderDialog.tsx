import type { PresentationItem } from '@gp/core';
import { useState, type ReactNode } from 'react';
import { useDb } from '../../db/react.tsx';
import { t } from '../../i18n.ts';
import { newId } from '../../ids.ts';
import { AppButton } from '../../ui/AppButton.tsx';
import { useTrySave } from '../../ui/AutoSave.tsx';
import { Dialog, DialogButtons } from '../../ui/Dialog.tsx';
import { FloatingInput } from '../../ui/Floating.tsx';

/** Where a new heading goes: after an item (or last), or right before one ("Ny rubrik ovanför"). */
export type HeaderPlace = { afterItemId: string | null } | { beforeItemId: string };

/**
 * One text of an item asked for in a small dialog, as iOS asks for a new list's name: an item's texts are not edited
 * in the list (that confused, Lars 2026-11-02). The title says what it is, so the field has its name only as its
 * placeholder (Lars, 2026-11-05: a label over one field adds nothing). Saved by `save`, which says whether it went through; blank is allowed
 * only where it removes the text (`optional`).
 */
function TextDialog({ title, label, initial, optional, submit, save, onClose }: { title: string; label: string; initial: string; optional?: boolean; submit: string; save: (text: string) => Promise<boolean>; onClose: () => void }) {
  const [text, setText] = useState(initial);
  const [saving, setSaving] = useState(false);
  const blocked = (!optional && !text.trim()) || saving;
  return (
    <Dialog title={title} onClose={onClose} maxWidthClass="max-w-md">
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (blocked) return;
          setSaving(true);
          const saved = await save(text.trim());
          setSaving(false);
          if (saved) onClose();
        }}
      >
        <FloatingInput label={label} hideLabel autoFocus maxLength={200} value={text} onFocus={(e) => e.currentTarget.select()} onChange={(e) => setText(e.target.value)} />
        <DialogButtons>
          <AppButton variant="cancel" onClick={onClose}>
            {t('common.cancel')}
          </AppButton>
          <AppButton type="submit" disabled={blocked}>
            {submit}
          </AppButton>
        </DialogButtons>
      </form>
    </Dialog>
  );
}

/** A heading of the running order (spec 03 2f): a name only. `item` renames one (Byt namn). */
function HeaderDialog({ presentationId, place, item, onAdded, onClose }: { presentationId: string; place?: HeaderPlace; item?: PresentationItem; onAdded?: (itemId: string) => void; onClose: () => void }) {
  const db = useDb();
  const trySave = useTrySave();
  return (
    <TextDialog
      title={t(item ? 'header.rename' : 'header.new')}
      label={t('header.name')}
      initial={item?.title ?? ''}
      submit={t(item ? 'common.save' : 'presentation.addTitle')}
      save={async (title) => {
        if (item) return trySave(db.mutate('renameItem', { itemId: item.id, title }));
        const itemId = newId();
        const saved = await trySave(db.mutate('addHeaderToPresentation', { itemId, presentationId, title, ...(place ?? { afterItemId: null }) }));
        if (saved) onAdded?.(itemId);
        return saved;
      }}
      onClose={onClose}
    />
  );
}

/**
 * An item's comment (spec 03 2f), for those who run it: "Solosång, men texten ska visas ändå". One line, short, so
 * Enter saves it (Lars, 2026-11-05). Blank removes it.
 */
function NoteDialog({ item, onClose }: { item: PresentationItem; onClose: () => void }) {
  const db = useDb();
  const trySave = useTrySave();
  return (
    <TextDialog
      title={t('note.title')}
      label={t('note.label')}
      initial={item.note ?? ''}
      optional
      submit={t('common.save')}
      save={(note) => trySave(db.mutate('setItemNote', { itemId: item.id, note }))}
      onClose={onClose}
    />
  );
}

/**
 * A page's headings and comments (spec 03 2f): `addHeader` asks for a new heading's name at a place, `menu` is what an
 * item's menu does for them (ItemContextMenu), and `dialogs` the dialog open, to render. `onAdded` names a new heading.
 */
export function useItemTexts(presentationId: string, onAdded: (itemId: string) => void) {
  const [heading, setHeading] = useState<{ place?: HeaderPlace; item?: PresentationItem } | null>(null);
  const [noting, setNoting] = useState<PresentationItem | null>(null);
  const dialogs: ReactNode = (
    <>
      {heading && <HeaderDialog presentationId={presentationId} place={heading.place} item={heading.item} onAdded={onAdded} onClose={() => setHeading(null)} />}
      {noting && <NoteDialog item={noting} onClose={() => setNoting(null)} />}
    </>
  );
  return {
    addHeader: (place: HeaderPlace) => setHeading({ place }),
    menu: {
      onHeaderAbove: (item: PresentationItem) => setHeading({ place: { beforeItemId: item.id } }),
      onRename: (item: PresentationItem) => setHeading({ item }),
      onNote: setNoting,
    },
    dialogs,
  };
}
