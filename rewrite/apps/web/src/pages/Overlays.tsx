import { useEffect, useState } from 'react';
import { OVERLAY_LIMITS, type LibraryImage, type Overlay } from '@gp/core';
import { useBlobUrl, useData, useDb, useShownOverlay } from '../db/react.tsx';
import { getImage, getOverlay, listImages, listOverlays } from '../db/queries.ts';
import { t } from '../i18n.ts';
import { newId } from '../ids.ts';
import { AppButton } from '../ui/AppButton.tsx';
import { IMAGE_ACCEPT, useMediaImport } from '../media/imports.ts';
import { AutoSaveField, useSaveFailed, useSavedIndicator, useTrySave } from '../ui/AutoSave.tsx';
import { afterWrite } from '../ui/debounce.ts';
import { deleteAsk, Dialog, DialogButtons, useConfirm } from '../ui/Dialog.tsx';
import { DropHint, DropZone } from '../ui/DropZone.tsx';
import { EmptyPicture, PICTURE } from '../ui/Empty.tsx';
import { FloatingInput } from '../ui/Floating.tsx';
import { OverlaysPicture, PhotoOutlineIcon, PlusIcon } from '../ui/icons.tsx';
import { CARD } from '../ui/List.tsx';
import { DetailHeader, PageContainer, PageHeader } from '../ui/PageContainer.tsx';
import { href, navigate } from '../ui/router.ts';
import { SlideView } from '../ui/SlideView.tsx';
import { ImageThumb } from './Images.tsx';

/** "Skapa overlay": a title, then the overlay's page (Components/Presentations/NameDialog.razor). */
function CreateDialog({ onClose }: { onClose: () => void }) {
  const db = useDb();
  const trySave = useTrySave();
  const [title, setTitle] = useState('');
  return (
    <Dialog title={t('overlays.createTitle')} onClose={onClose} maxWidthClass="max-w-2xl">
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!title.trim()) return;
          const id = newId();
          if (!(await trySave(db.mutate('createOverlay', { id, title })))) return;
          navigate({ page: 'overlay', id });
        }}
      >
        <FloatingInput label={t('overlays.createName')} autoFocus maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
        <DialogButtons>
          <AppButton variant="cancel" onClick={onClose}>
            {t('common.cancel')}
          </AppButton>
          <AppButton type="submit" disabled={!title.trim()}>
            {t('common.create')}
          </AppButton>
        </DialogButtons>
      </form>
    </Dialog>
  );
}

/** An overlay's picture as a small 16:9 thumbnail in the list, or a grey box with a picture icon when it has none (Overlays.razor). */
function OverlayThumb({ overlay }: { overlay: Pick<Overlay, 'id'> }) {
  const shown = useShownOverlay(overlay.id);
  const url = useBlobUrl(shown?.imageHash ?? null);
  return url ? (
    <img src={url} alt="" draggable={false} className="w-16 h-9 object-cover rounded border border-neutral-200 dark:border-neutral-600 shrink-0" />
  ) : (
    <div className="w-16 h-9 rounded border border-neutral-200 dark:border-neutral-600 bg-neutral-200 dark:bg-neutral-700 shrink-0 flex items-center justify-center">
      <PhotoOutlineIcon className="size-4 text-neutral-400" strokeWidth={1.5} />
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
  const create = (
    <AppButton onClick={() => setCreating(true)} className="flex items-center gap-1.5">
      <PlusIcon className="size-4" />
      {t('common.create')}
    </AppButton>
  );
  return (
    <PageContainer>
      {/* Skapa sits in the heading once there is a list; before that, in the empty card. */}
      <PageHeader title={t('overlays.title')}>{!!overlays?.length && create}</PageHeader>
      <div className={CARD}>
        {!overlays && <div className="px-5 py-4 text-neutral-400 text-sm">{t('common.loading')}</div>}
        {overlays && !overlays.length && (
          <EmptyPicture picture={<OverlaysPicture className={PICTURE} />} title={t('overlays.empty')} text={t('overlays.emptyText')}>
            {create}
          </EmptyPicture>
        )}
        <ul aria-label={t('overlays.title')}>
          {overlays?.map((o) => (
            <li key={o.id} className="border-b border-neutral-200 dark:border-neutral-700 last:border-b-0">
              <a href={href({ page: 'overlay', id: o.id })} className="flex items-center gap-3 px-5 py-3 hover:bg-neutral-100 dark:hover:bg-neutral-700/50 no-underline text-inherit">
                <OverlayThumb overlay={o} />
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{o.title}</div>
                  {o.content?.trim() && <div className="text-xs text-neutral-400 truncate">{o.content}</div>}
                </div>
              </a>
            </li>
          ))}
        </ul>
      </div>
      {creating && <CreateDialog onClose={() => setCreating(false)} />}
    </PageContainer>
  );
}

/** Picks a picture from the media library (spec 05): overlays use the library's pictures. Drawn as the add dialog's picture grid (ImageTab.tsx). */
function ImagePicker({ onPick, onClose }: { onPick: (image: LibraryImage) => void; onClose: () => void }) {
  const images = useData(listImages, []);
  return (
    <Dialog title={t('overlays.pickImage')} onClose={onClose} wide>
      {images && !images.length && <p className="text-sm text-neutral-400 dark:text-neutral-500">{t('presentation.noImages')}</p>}
      <ul className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-1 items-center empty:hidden" aria-label={t('images.title')}>
        {images?.map((image) => (
          <li key={image.id} className="relative p-2 flex flex-col items-center min-w-0">
            <AppButton variant="plain" onClick={() => onPick(image)} className="flex flex-col items-center w-full min-w-0 cursor-pointer rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-700 p-1">
              <ImageThumb image={image} />
              <span className="block text-xs text-neutral-500 dark:text-neutral-400 truncate mt-1 text-center w-full" title={image.fileName}>
                {image.fileName}
              </span>
            </AppButton>
          </li>
        ))}
      </ul>
      <DialogButtons>
        <AppButton variant="cancel" onClick={onClose}>
          {t('common.cancel')}
        </AppButton>
      </DialogButtons>
    </Dialog>
  );
}

/**
 * One overlay (spec 03 §4; OverlayDetail.razor, OverlayEditor.razor): title, text and an
 * optional picture. A field saves 500 ms after the last keystroke, with "Sparad" in the
 * header; a blank title is never saved (PRES-E18). A picture dropped on the picture's
 * area is imported into Bilder and chosen (the picture comes from Bilder). An unknown id
 * goes back to the list. Deleting is permanent and asks first (PRES-R29).
 */
export function OverlayEditor({ id }: { id: string }) {
  const db = useDb();
  const trySave = useTrySave();
  const { dialog, ask } = useConfirm();
  const saveFailed = useSaveFailed();
  const saved = useSavedIndicator();
  const { run, progress, failures } = useMediaImport('image');
  const data = useData(
    async (d) => {
      const overlay = await getOverlay(d, id);
      return { overlay, image: overlay?.imageId ? await getImage(d, overlay.imageId) : null };
    },
    [id],
  );
  const [picking, setPicking] = useState(false);
  const missing = !!data && !data.overlay;
  useEffect(() => {
    if (missing) navigate({ page: 'overlays' });
  }, [missing]);
  if (!data?.overlay)
    return (
      <PageContainer>
        <DetailHeader backHref={href({ page: 'overlays' })} title="" className="px-5" />
        {!data && <div className="px-7 text-neutral-400">{t('common.loading')}</div>}
      </PageContainer>
    );
  const { overlay, image } = data;

  const update = (fields: { title?: string; content?: string | null }) => db.mutate('updateOverlay', { id, ...fields });
  const setImage = (imageId: string | null) => afterWrite(db.mutate('updateOverlay', { id, imageId }), saved.show, saveFailed);
  const dropped = async (files: File[]) => {
    const [added] = await run(files);
    if (added) setImage(added);
  };
  // Once deleted, the overlay is missing and the page goes back to the list; no toast, as the current app.
  const remove = () => ask(deleteAsk(t('overlays.removeConfirm', { title: overlay.title }), overlay.title, () => trySave(db.mutate('deleteOverlay', { id }))));

  return (
    <PageContainer>
      {dialog}
      <DetailHeader backHref={href({ page: 'overlays' })} title={overlay.title} saved={saved.node} className="px-5" />
      <div className={`${CARD} p-5 space-y-4`}>
        <AutoSaveField label={t('overlays.name')} maxLength={200} value={overlay.title} onSave={(v) => (v.trim() ? update({ title: v }) : undefined)} onSaved={saved.show} />
        <AutoSaveField
          label={t('overlays.content')}
          multiline
          showLabel
          rows={4}
          maxLength={OVERLAY_LIMITS.content}
          value={overlay.content ?? ''}
          onSave={(v) => update({ content: v })}
          onSaved={saved.show}
        />
        <DropZone compact label={t('overlays.dropImage')} accept={IMAGE_ACCEPT} multiple={false} onFiles={(files) => void dropped(files)}>
          <div className="block text-sm font-medium mb-1">{t('overlays.image')}</div>
          <div className="flex items-center gap-3">
            {image && <ImageThumb image={image} className="w-48 h-[108px] object-cover rounded-lg border border-neutral-200 dark:border-neutral-600" />}
            {overlay.imageId && !image && <span className="text-sm text-amber-600 dark:text-amber-400">{t('live.imageMissing')}</span>}
            <div className="flex flex-col items-start gap-1">
              <AppButton variant="secondary" disabled={!!progress} onClick={() => setPicking(true)}>
                {overlay.imageId ? t('overlays.changeImage') : t('overlays.chooseImage')}
              </AppButton>
              {overlay.imageId && (
                <AppButton variant="danger" className="text-left" onClick={() => setImage(null)}>
                  {t('overlays.removeImage')}
                </AppButton>
              )}
            </div>
          </div>
          <DropHint text={t('overlays.dropAffordance')} className="hidden sm:block mt-1" />
          {progress && (
            <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400" role="status">
              {t('images.importing', progress)}
            </p>
          )}
          {!!failures.length && (
            <p className="mt-1 text-sm text-red-500 dark:text-red-400" role="alert" data-testid="overlay-image-failure">
              {failures[0]}
            </p>
          )}
        </DropZone>
        <div>
          <h2 className="block text-sm/5 font-medium mb-1">{t('overlays.preview')}</h2>
          <div className="max-w-[640px] aspect-video rounded-lg overflow-hidden">
            <SlideView slide={null} overlay={{ content: overlay.content, imageHash: image?.fullHash ?? null }} />
          </div>
        </div>
      </div>
      <div className="flex justify-end">
        <AppButton variant="danger" onClick={() => void remove()}>
          {t('common.delete')}
        </AppButton>
      </div>
      {picking && (
        <ImagePicker
          onClose={() => setPicking(false)}
          onPick={(picked) => {
            setPicking(false);
            setImage(picked.id);
          }}
        />
      )}
    </PageContainer>
  );
}
