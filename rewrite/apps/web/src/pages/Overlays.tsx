import { useState } from 'react';
import { OVERLAY_LIMITS, type LibraryImage, type Overlay } from '@gp/core';
import { useData, useDb, useShownOverlay } from '../db/react.tsx';
import { getImage, getOverlay, listImages, listOverlays } from '../db/queries.ts';
import { t } from '../i18n.ts';
import { newId } from '../ids.ts';
import { Button } from '../ui/Button.tsx';
import { Dialog, useConfirm } from '../ui/Dialog.tsx';
import { href, navigate } from '../ui/router.ts';
import { SlideView } from '../ui/SlideView.tsx';
import { useToast } from '../ui/Toast.tsx';
import { ImageThumb } from './Images.tsx';

function CreateDialog({ onClose }: { onClose: () => void }) {
  const db = useDb();
  const [title, setTitle] = useState('');
  return (
    <Dialog title={t('overlays.createTitle')} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!title.trim()) return;
          const id = newId();
          await db.mutate('createOverlay', { id, title });
          navigate({ page: 'overlay', id });
        }}
      >
        <label className="field">
          {t('overlays.name')}
          <input autoFocus maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <div className="row end">
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" type="submit" disabled={!title.trim()}>
            {t('common.create')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** An overlay drawn as it shows above a slide, small: for the list and the editor. */
function OverlayPreview({ overlay }: { overlay: Pick<Overlay, 'id'> }) {
  const shown = useShownOverlay(overlay.id);
  return (
    <div className="frame">
      <SlideView slide={null} overlay={shown} />
    </div>
  );
}

/**
 * Overlays (spec 03 §4 `/admin/overlays`): text and pictures shown above the
 * live slide, e.g. a Swish number at the collection. Everyone may make and
 * change them (ManageOverlays is every role's).
 */
export function Overlays() {
  const overlays = useData(listOverlays, []);
  const [creating, setCreating] = useState(false);
  return (
    <section>
      <div className="row">
        <h1 className="grow">{t('overlays.title')}</h1>
        <Button variant="primary" onClick={() => setCreating(true)}>
          {t('common.create')}
        </Button>
      </div>
      {overlays && !overlays.length && (
        <div className="empty">
          <p>
            <strong>{t('overlays.empty')}</strong>
          </p>
          <p className="muted">{t('overlays.emptyText')}</p>
        </div>
      )}
      <ul className="image-grid" aria-label={t('overlays.title')}>
        {overlays?.map((o) => (
          <li key={o.id} className="image-card">
            <a href={href({ page: 'overlay', id: o.id })} className="overlay-card">
              <OverlayPreview overlay={o} />
              <div className="name">{o.title}</div>
              {o.content && <div className="muted small name">{o.content.split('\n')[0]}</div>}
            </a>
          </li>
        ))}
      </ul>
      {creating && <CreateDialog onClose={() => setCreating(false)} />}
    </section>
  );
}

/** Picks a picture from the media library (spec 05): overlays use the library's pictures. */
function ImagePicker({ onPick, onClose }: { onPick: (image: LibraryImage) => void; onClose: () => void }) {
  const images = useData(listImages, []);
  return (
    <Dialog title={t('overlays.pickImage')} onClose={onClose} wide>
      {images && !images.length && <p className="muted">{t('presentation.noImages')}</p>}
      <ul className="image-grid" aria-label={t('images.title')}>
        {images?.map((image) => (
          <li key={image.id} className="image-card">
            <Button className="image-pick" onClick={() => onPick(image)}>
              <ImageThumb image={image} />
              <div className="name" title={image.fileName}>
                {image.fileName}
              </div>
            </Button>
          </li>
        ))}
      </ul>
      <div className="row end">
        <Button onClick={onClose}>{t('common.cancel')}</Button>
      </div>
    </Dialog>
  );
}

/**
 * One overlay (spec 03 §4): title, text and an optional picture. A field
 * saves when it loses focus, as song fields do; a blank title is never saved
 * (PRES-E18). Deleting is permanent and asks first (PRES-R29).
 */
export function OverlayEditor({ id }: { id: string }) {
  const db = useDb();
  const toast = useToast();
  const { dialog, ask } = useConfirm();
  const data = useData(
    async (d) => {
      const overlay = await getOverlay(d, id);
      return { overlay, image: overlay?.imageId ? await getImage(d, overlay.imageId) : null };
    },
    [id],
  );
  const [picking, setPicking] = useState(false);
  if (!data) return null;
  const { overlay, image } = data;
  if (!overlay) return <p>{t('overlays.notFound')}</p>;

  const save = (fields: { title?: string; content?: string | null; imageId?: string | null }) => void db.mutate('updateOverlay', { id, ...fields });
  const remove = async () => {
    const ok = await ask({ title: t('overlays.removeTitle'), text: t('overlays.removeConfirm', { title: overlay.title }), confirm: t('common.delete') });
    if (!ok) return;
    await db.mutate('deleteOverlay', { id });
    toast(t('overlays.removed', { title: overlay.title }));
    navigate({ page: 'overlays' });
  };

  return (
    <section className="overlay-editor">
      {dialog}
      <div className="row">
        <a href={href({ page: 'overlays' })}>← {t('overlays.title')}</a>
        <span className="grow" />
        <Button variant="danger" onClick={() => void remove()}>
          {t('common.delete')}
        </Button>
      </div>
      <label className="field">
        {t('overlays.name')}
        <input
          maxLength={200}
          defaultValue={overlay.title}
          onBlur={(e) => {
            const v = e.currentTarget.value;
            if (v.trim() && v.trim() !== overlay.title) save({ title: v });
          }}
        />
      </label>
      <label className="field">
        {t('overlays.content')}
        <textarea
          rows={4}
          maxLength={OVERLAY_LIMITS.content}
          defaultValue={overlay.content ?? ''}
          onBlur={(e) => {
            const v = e.currentTarget.value;
            if ((v.trim() || null) !== overlay.content) save({ content: v });
          }}
        />
      </label>
      <div className="field">
        {t('overlays.image')}
        <div className="row">
          {image && (
            <div className="image-card overlay-thumb">
              <ImageThumb image={image} />
            </div>
          )}
          {overlay.imageId && !image && <span className="warning">{t('live.imageMissing')}</span>}
          <Button onClick={() => setPicking(true)}>{overlay.imageId ? t('overlays.changeImage') : t('overlays.chooseImage')}</Button>
          {overlay.imageId && <Button onClick={() => save({ imageId: null })}>{t('overlays.removeImage')}</Button>}
        </div>
      </div>
      <h2>{t('overlays.preview')}</h2>
      <div className="overlay-preview">
        <SlideView slide={null} overlay={{ content: overlay.content, imageHash: image?.fullHash ?? null }} />
      </div>
      {picking && (
        <ImagePicker
          onClose={() => setPicking(false)}
          onPick={(picked) => {
            setPicking(false);
            save({ imageId: picked.id });
          }}
        />
      )}
    </section>
  );
}
