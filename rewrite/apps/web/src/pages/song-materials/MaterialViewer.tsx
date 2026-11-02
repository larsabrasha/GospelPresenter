import type { SongMaterial } from '@gp/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useDb } from '../../db/react.tsx';
import type { MediaBytes } from '../../db/share.ts';
import { t } from '../../i18n.ts';
import { AppButton } from '../../ui/AppButton.tsx';
import { PageDialog } from '../../ui/Dialog.tsx';
import { ArrowDownTrayIcon, ArrowTopRightOnSquareIcon, MinusIcon, PlusIcon, ShareIcon } from '../../ui/icons.tsx';

/** How far the pages may be zoomed, from the dialog's width. */
const ZOOMS = [1, 1.5, 2, 3];
const ACTION = 'h-9 px-3.5 rounded-full flex items-center gap-1.5 text-sm font-medium cursor-pointer bg-raised dark:bg-raised-2 hover:bg-stone-200 dark:hover:bg-stone-600 no-underline text-stone-800 dark:text-stone-100';

/** The file's name to save or share it as: its title and the extension of what it is. */
function fileName(m: SongMaterial, type: string): string {
  const ext = type === 'application/pdf' ? 'pdf' : (type.split('/')[1] ?? 'audio').replace('mpeg', 'mp3').replace('x-m4a', 'm4a');
  return `${m.title}.${ext}`;
}

/**
 * A song's file opened (spec 02 "Song material"): a PDF's pages drawn by pdf.js, sharp at every zoom, or a recording's
 * player; Dela (the device's share sheet, where it has one), Öppna i webbläsaren (not in the desktop app, which keeps
 * its windows on the app) and Ladda ner. The file is fetched now if this device has none.
 */
export function MaterialViewer({ material, onClose }: { material: SongMaterial; onClose: () => void }) {
  const db = useDb();
  const [file, setFile] = useState<MediaBytes | null | 'loading'>('loading');
  useEffect(() => {
    let live = true;
    void db.openMedia(material.hash!).then((b) => live && setFile(b));
    return () => {
      live = false;
    };
  }, [db, material.hash]);
  const loaded = file !== 'loading' && file ? file : null;
  const blob = useMemo(() => (loaded ? new Blob([loaded.bytes as BlobPart], { type: loaded.contentType }) : null), [loaded]);
  const url = useMemo(() => (blob ? URL.createObjectURL(blob) : null), [blob]);
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);
  const name = loaded ? fileName(material, loaded.contentType) : material.title;
  const shareable = blob ? new File([blob], name, { type: blob.type }) : null;
  const canShare = !!shareable && typeof navigator.canShare === 'function' && navigator.canShare({ files: [shareable] });
  const [zoom, setZoom] = useState(0);
  const pdf = loaded?.contentType === 'application/pdf';

  return (
    <PageDialog title={material.title} onClose={onClose}>
      <div className="shrink-0 flex flex-wrap items-center gap-2 px-4 py-2.5 border-b-[0.5px] border-separator" role="toolbar" aria-label={material.title}>
        {canShare && (
          <AppButton variant="plain" className={ACTION} onClick={() => void navigator.share({ files: [shareable], title: material.title }).catch(() => {})}>
            <ShareIcon className="size-4" />
            {t('material.share')}
          </AppButton>
        )}
        {url && !window.gpDesktop && (
          <a href={url} target="_blank" rel="noopener" className={ACTION}>
            <ArrowTopRightOnSquareIcon className="size-4" />
            {t('material.openInBrowser')}
          </a>
        )}
        {url && (
          <a href={url} download={name} className={ACTION}>
            <ArrowDownTrayIcon className="size-4" strokeWidth={1.75} />
            {t('material.download')}
          </a>
        )}
        {pdf && (
          <span className="ml-auto flex items-center gap-1">
            <AppButton variant="plain" aria-label={t('material.zoomOut')} title={t('material.zoomOut')} disabled={zoom === 0} onClick={() => setZoom((z) => z - 1)} className={`${ACTION} px-2.5! disabled:opacity-40 disabled:cursor-default`}>
              <MinusIcon className="size-4" />
            </AppButton>
            <AppButton variant="plain" aria-label={t('material.zoomIn')} title={t('material.zoomIn')} disabled={zoom === ZOOMS.length - 1} onClick={() => setZoom((z) => z + 1)} className={`${ACTION} px-2.5! disabled:opacity-40 disabled:cursor-default`}>
              <PlusIcon className="size-4" />
            </AppButton>
          </span>
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-auto bg-stone-200 dark:bg-stone-900" data-testid="material-viewer">
        {file === 'loading' && <p className="p-6 text-sm text-stone-500">{t('material.loading')}</p>}
        {file === null && <p className="p-6 text-sm text-stone-500">{t('material.unavailable')}</p>}
        {loaded && pdf && <PdfPages bytes={loaded.bytes} zoom={ZOOMS[zoom]!} title={material.title} />}
        {loaded && !pdf && url && (
          <div className="p-6 flex justify-center">
            <audio controls src={url} className="w-full max-w-lg" aria-label={material.title} />
          </div>
        )}
      </div>
    </PageDialog>
  );
}

/** Every page of the PDF, one under the other at the box's width times `zoom`, drawn for the screen's pixels. */
function PdfPages({ bytes, zoom, title }: { bytes: Uint8Array; zoom: number; title: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const el = box.current;
    if (!el || !width) return;
    let cancelled = false;
    void (async () => {
      const pdfjs = await import('pdfjs-dist');
      pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
      // pdf.js takes the buffer over: it is given a copy, so the file stays whole for Dela and Ladda ner.
      const task = pdfjs.getDocument({ data: bytes.slice() });
      try {
        const doc = await task.promise;
        const pageWidth = Math.max(200, (width - 32) * zoom);
        const canvases: HTMLCanvasElement[] = [];
        for (let n = 1; n <= doc.numPages; n++) {
          if (cancelled) return; // a newer width or zoom draws them again
          const page = await doc.getPage(n);
          const base = page.getViewport({ scale: 1 });
          const scale = pageWidth / base.width;
          const viewport = page.getViewport({ scale: scale * devicePixelRatio });
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(viewport.width);
          canvas.height = Math.round(viewport.height);
          canvas.style.width = `${Math.round(pageWidth)}px`;
          canvas.className = 'block mx-auto mb-4 bg-white shadow-md';
          canvas.setAttribute('role', 'img');
          canvas.setAttribute('aria-label', `${title} ${n}`);
          await page.render({ canvas, viewport }).promise;
          canvases.push(canvas);
        }
        if (!cancelled) el.replaceChildren(...canvases);
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        void task.destroy();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bytes, width, zoom, title]);
  return (
    <>
      {failed && <p className="p-6 text-sm text-stone-500">{t('material.unreadable')}</p>}
      <div ref={box} className="p-4 min-w-full w-max" data-testid="pdf-pages" />
    </>
  );
}
