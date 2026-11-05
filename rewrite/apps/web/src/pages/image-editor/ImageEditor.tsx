import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ImageEdit, LibraryImage } from '@gp/core';
import { useDb } from '../../db/react.tsx';
import { t } from '../../i18n.ts';
import { cropOfAspect, drawEdited, isNoEdit, NO_EDIT, readEdit, turnedSize } from '../../media/imageEdit.ts';
import { renderEditedImage } from '../../media/process.ts';
import { AppButton } from '../../ui/AppButton.tsx';
import { useTrySave } from '../../ui/AutoSave.tsx';
import { ArrowUturnLeftIcon, ArrowsRightLeftIcon, CheckIcon, CloseIcon } from '../../ui/icons.tsx';
import { CropFrame } from './CropFrame.tsx';

// A library picture's editor (MEDIA-R19, docs/media-and-files.md "Editing a picture"), as Photos' crop view on an
// iPhone: the whole picture with the crop's frame over it, straightened by a slider, turned a quarter to the left,
// mirrored, and a format for the crop. Held, Original shows the picture as it was imported, a label saying so (Lars,
// 2026-11-05: without it a held finger only made the picture jump). It is always edited from the original, so Klar
// replaces the edit before and Återställ in it starts again from the original.

/** The formats of the crop, as Photos lists them: free, the original's, the screen's first. */
const FORMATS: { key: string; label: () => string; aspect: (w: number, h: number) => number | null }[] = [
  { key: 'free', label: () => t('imageEditor.free'), aspect: () => null },
  { key: '16:9', label: () => '16:9', aspect: () => 16 / 9 },
  { key: 'original', label: () => t('imageEditor.originalFormat'), aspect: (w, h) => w / h },
  { key: '4:3', label: () => '4:3', aspect: () => 4 / 3 },
  { key: 'square', label: () => t('imageEditor.square'), aspect: () => 1 },
];

/** The original picture's bitmap, decoded from this device's copy (fetched if it is not here). */
function useOriginal(hash: string): ImageBitmap | null | undefined {
  const db = useDb();
  const [bitmap, setBitmap] = useState<ImageBitmap | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    let made: ImageBitmap | null = null;
    void db
      .openMedia(hash)
      .then(async (m) => (m ? createImageBitmap(new Blob([m.bytes as BlobPart], { type: m.contentType })) : null))
      .then((b) => {
        made = b;
        if (live) setBitmap(b);
        else b?.close();
      })
      .catch(() => live && setBitmap(null));
    return () => {
      live = false;
      made?.close();
    };
  }, [db, hash]);
  return bitmap;
}

const ROUND = 'size-11 rounded-full flex items-center justify-center cursor-pointer';
const TOOL = 'size-11 rounded-full flex items-center justify-center cursor-pointer text-white bg-white/10 hover:bg-white/20';

export function ImageEditor({ image, onClose }: { image: LibraryImage; onClose: () => void }) {
  const db = useDb();
  const trySave = useTrySave();
  const originalHash = image.originalFullHash ?? image.fullHash;
  const size = image.originalWidth && image.originalHeight ? { width: image.originalWidth, height: image.originalHeight } : { width: image.width, height: image.height };
  const bitmap = useOriginal(originalHash);
  const [edit, setEdit] = useState<ImageEdit>(() => readEdit(image.edit));
  const [format, setFormat] = useState('free');
  const [showingOriginal, setShowingOriginal] = useState(false);
  const [saving, setSaving] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const drawing = useRef<HTMLCanvasElement>(null);
  const [room, setRoom] = useState({ width: 0, height: 0 });

  const frame = turnedSize(size.width, size.height, edit.rotate);
  const aspect = FORMATS.find((f) => f.key === format)!.aspect(size.width, size.height);
  // The picture as large as the stage lets it, with room round it for the crop's corners.
  const fit = Math.min((room.width - 32) / (showingOriginal ? size.width : frame.width), (room.height - 32) / (showingOriginal ? size.height : frame.height));
  const shown = showingOriginal ? size : frame;
  const drawn = { width: Math.max(1, Math.floor(shown.width * fit)), height: Math.max(1, Math.floor(shown.height * fit)) };

  useLayoutEffect(() => {
    const el = stage.current!;
    const measure = () => setRoom({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The whole turned, straightened picture under the frame; held, the original as it was.
  const drawnWidth = drawn.width;
  const drawnHeight = drawn.height;
  const sourceWidth = size.width;
  const sourceHeight = size.height;
  useEffect(() => {
    const c = drawing.current;
    if (!c || !bitmap || fit <= 0) return;
    const ratio = devicePixelRatio || 1;
    c.width = Math.round(drawnWidth * ratio);
    c.height = Math.round(drawnHeight * ratio);
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    drawEdited(ctx, bitmap, sourceWidth, sourceHeight, showingOriginal ? NO_EDIT : edit, c.width, c.height, true);
  }, [drawing, bitmap, edit, showingOriginal, drawnWidth, drawnHeight, sourceWidth, sourceHeight, fit]);

  const change = (patch: Partial<ImageEdit>) => setEdit((e) => ({ ...e, ...patch }));
  /** A quarter to the left, as Photos' button turns it; the crop turns with the picture. */
  const turnLeft = () =>
    setEdit((e) => {
      const c = e.crop;
      return { ...e, rotate: (((e.rotate + 270) % 360) as ImageEdit['rotate']), crop: { x: c.y, y: 1 - c.x - c.w, w: c.h, h: c.w } };
    });
  const mirror = () => setEdit((e) => ({ ...e, flip: !e.flip, crop: { ...e.crop, x: 1 - e.crop.x - e.crop.w } }));
  const chooseFormat = (key: string) => {
    setFormat(key);
    const f = FORMATS.find((x) => x.key === key)!;
    change({ crop: cropOfAspect(f.aspect(size.width, size.height), frame.width, frame.height) });
  };

  const save = async () => {
    if (!bitmap || saving) return;
    setSaving(true);
    try {
      if (isNoEdit(edit)) {
        // Back to the original, if it was edited; nothing to do if it never was.
        if (image.originalFullHash && !(await trySave(db.mutate('revertImage', { id: image.id })))) return;
      } else {
        const type = image.contentType === 'image/jpeg' ? 'image/jpeg' : 'image/webp';
        const edited = await renderEditedImage(bitmap, size, edit, image.id, type);
        if (!(await trySave(db.editImage(edited)))) return;
      }
      onClose();
    } finally {
      setSaving(false);
    }
  };

  // Escape is Avbryt; M held shows the original, as in Photos on a Mac.
  const key = useEffectEvent((e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement && e.target.type !== 'range') return;
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
    } else if (e.key.toLowerCase() === 'm' && !e.repeat) setShowingOriginal(e.type === 'keydown');
  });
  useEffect(() => {
    const on = (e: KeyboardEvent) => key(e);
    addEventListener('keydown', on, true);
    addEventListener('keyup', on, true);
    return () => {
      removeEventListener('keydown', on, true);
      removeEventListener('keyup', on, true);
    };
  }, []);

  const hold = {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      setShowingOriginal(true);
    },
    onPointerUp: () => setShowingOriginal(false),
    onPointerCancel: () => setShowingOriginal(false),
    onKeyDown: (e: React.KeyboardEvent) => (e.key === ' ' || e.key === 'Enter') && setShowingOriginal(true),
    onKeyUp: () => setShowingOriginal(false),
  };

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={t('imageEditor.title', { name: image.fileName })} className="fixed inset-0 z-[150] flex flex-col bg-black text-white pt-safe-top pb-safe-bottom" data-testid="image-editor">
      <div className="relative flex items-center justify-between px-4 h-16 shrink-0">
        {/* ✕ and ✓, round, as iOS 27's Photos (Lars, 2026-11-05: no words); the words are their names. */}
        <AppButton variant="plain" aria-label={t('common.cancel')} title={t('common.cancel')} className={`${ROUND} bg-white/10 hover:bg-white/20 text-white`} onClick={onClose}>
          <CloseIcon className="size-5" />
        </AppButton>
        {/* Held, the original, said in the middle of the bar as Photos says ORIGINAL; one button throughout, so the
            finger that holds it is the one that lets go. */}
        <AppButton
          variant="plain"
          className={`absolute left-1/2 -translate-x-1/2 h-9 px-4 rounded-full text-sm cursor-pointer select-none touch-none ${showingOriginal ? 'bg-white text-black text-xs font-semibold tracking-wider uppercase' : 'bg-white/10 hover:bg-white/20'}`}
          title={t('imageEditor.holdForOriginal')}
          aria-pressed={showingOriginal}
          data-testid="compare"
          {...hold}
        >
          {showingOriginal ? <span data-testid="showing-original">{t('imageEditor.original')}</span> : t('imageEditor.compare')}
        </AppButton>
        <AppButton
          variant="plain"
          aria-label={t('library.done')}
          title={t('library.done')}
          disabled={!bitmap || saving}
          className={`${ROUND} bg-sky-500 hover:bg-sky-600 text-white disabled:bg-white/10 disabled:text-white/40 disabled:cursor-default`}
          onClick={() => void save()}
        >
          <CheckIcon className="size-5" />
        </AppButton>
      </div>

      {/* Clipped here, so the dimming round the crop stops at the stage and its corners reach past the picture. */}
      <div ref={stage} className="relative flex-1 min-h-0 flex items-center justify-center select-none overflow-hidden">
        {bitmap === undefined && <p className="text-stone-400">{t('images.fetching')}</p>}
        {bitmap === null && <p className="text-stone-400">{t('common.error')}</p>}
        {bitmap && (
          <div className="relative" style={{ width: drawn.width, height: drawn.height }}>
            <canvas ref={drawing} className="block size-full" data-testid="image-editor-canvas" />
            {/* Over the original too, unseen, so a finger held on the picture lets go where it holds. */}
            <CropFrame width={drawn.width} height={drawn.height} crop={edit.crop} aspect={aspect} hidden={showingOriginal} onChange={(crop) => change({ crop })} onHold={setShowingOriginal} />
          </div>
        )}
      </div>

      <div className="shrink-0 flex flex-col gap-4 px-4 pt-3 pb-5">
        <label className="flex items-center gap-3 text-sm">
          <span className="w-20 shrink-0 text-stone-300">{t('imageEditor.straighten')}</span>
          <input
            type="range"
            min={-45}
            max={45}
            step={0.5}
            value={edit.straighten}
            onChange={(e) => change({ straighten: Number(e.target.value) })}
            onDoubleClick={() => change({ straighten: 0 })}
            className="flex-1 accent-white"
            aria-label={t('imageEditor.straighten')}
          />
          <span className="w-12 text-right tabular-nums text-stone-300">{edit.straighten.toFixed(1).replace('.0', '')}°</span>
        </label>
        {/* The crop's formats as a row, as Photos lists them, the chosen one white. */}
        <div role="radiogroup" aria-label={t('imageEditor.format')} className="flex items-center justify-center gap-2 overflow-x-auto">
          {FORMATS.map((f) => (
            <AppButton
              key={f.key}
              variant="plain"
              role="radio"
              aria-checked={f.key === format}
              className={`h-8 px-3 rounded-full text-[13px] shrink-0 cursor-pointer ${f.key === format ? 'bg-white text-black font-semibold' : 'bg-white/10 text-white hover:bg-white/20'}`}
              onClick={() => chooseFormat(f.key)}
            >
              {f.label()}
            </AppButton>
          ))}
        </div>
        <div className="flex items-center justify-center gap-4">
          <AppButton variant="plain" className={TOOL} aria-label={t('imageEditor.rotate')} title={t('imageEditor.rotate')} onClick={turnLeft}>
            <ArrowUturnLeftIcon className="size-5" />
          </AppButton>
          <AppButton variant="plain" className={TOOL} aria-label={t('imageEditor.flip')} title={t('imageEditor.flip')} onClick={mirror}>
            <ArrowsRightLeftIcon className="size-5" />
          </AppButton>
          <AppButton
            variant="plain"
            className="h-11 px-4 rounded-full text-sm cursor-pointer text-amber-300 hover:bg-white/10 disabled:opacity-40 disabled:cursor-default"
            disabled={isNoEdit(edit)}
            onClick={() => {
              setEdit(NO_EDIT);
              setFormat('free');
            }}
          >
            {t('imageEditor.reset')}
          </AppButton>
        </div>
      </div>
    </div>,
    document.body,
  );
}
