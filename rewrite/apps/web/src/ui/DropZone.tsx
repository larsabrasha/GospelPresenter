import { useEffect, useState, type DragEvent, type ReactNode } from 'react';
import { t } from '../i18n.ts';
import { ArrowDownTrayIcon } from './icons.tsx';
import { useToast } from './Toast.tsx';

/** Whether a drag carries files (a dragged text or link does not). */
const hasFiles = (e: { dataTransfer: DataTransfer | null }) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');

/** Whether `file` matches an `accept` list: `.ext`, `type/*` or a full type (utils.js _acceptsFile). */
export function acceptsFile(file: { name: string; type: string }, accept: string | undefined): boolean {
  if (!accept) return true;
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  return accept
    .split(',')
    .map((p) => p.trim().toLowerCase())
    .some((p) => (p.startsWith('.') ? name.length > p.length && name.endsWith(p) : p.endsWith('/*') ? !!type && type.startsWith(p.slice(0, -1)) : !!type && type === p));
}

/**
 * A file dropped anywhere but on a drop zone is swallowed, so the browser does not open it and
 * leave the app (utils.js _installDropGuard). Once per page.
 */
export function useDropGuard() {
  useEffect(() => {
    const swallow = (e: globalThis.DragEvent) => {
      if (!hasFiles(e)) return;
      if (e.target instanceof Element && e.target.closest('[data-dropzone], input[type="file"]')) return;
      e.preventDefault();
    };
    addEventListener('dragover', swallow);
    addEventListener('drop', swallow);
    return () => {
      removeEventListener('dragover', swallow);
      removeEventListener('drop', swallow);
    };
  }, []);
}

/**
 * An area that takes dropped files (Components/DropZone.razor). While files hover over it, a
 * dashed sky frame covers it with `label` ("Släpp filerna här" by default); `compact` leaves out
 * the icon. Only the files `accept` takes go to `onFiles`, the first alone unless `multiple`; none
 * that fits says so in a toast. `enabled` false takes nothing, as for a user who may not import.
 */
export function DropZone({
  label,
  onFiles,
  accept,
  multiple = true,
  enabled = true,
  compact,
  className,
  children,
}: {
  label?: string;
  onFiles: (files: File[]) => void;
  accept?: string;
  multiple?: boolean;
  enabled?: boolean;
  compact?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const toast = useToast();
  const [dragging, setDragging] = useState(false);
  const leave = (e: DragEvent) => {
    // Moving onto a child is not leaving the zone.
    if (!(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget))) setDragging(false);
  };
  return (
    <div
      data-dropzone
      className={`relative ${className ?? ''}`}
      onDragOver={(e) => {
        if (!hasFiles(e) || !enabled) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        setDragging(true);
      }}
      onDragLeave={leave}
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        setDragging(false);
        if (!enabled) return;
        const dropped = [...e.dataTransfer.files];
        if (!dropped.length) return;
        const fitting = dropped.filter((f) => acceptsFile(f, accept));
        if (!fitting.length) return toast(t('drop.wrongType'), 'warning');
        onFiles(multiple ? fitting : fitting.slice(0, 1));
      }}
    >
      {children}
      {dragging && (
        <div className="absolute inset-0 z-20 overflow-hidden rounded-xl border-2 border-dashed border-sky-500 bg-white/85 dark:bg-neutral-900/85 pointer-events-none">
          {/* Sticky, so the hint stays in view when the zone is taller than the window. */}
          <div className="sticky top-0 h-screen max-h-full flex flex-col items-center justify-center gap-2 px-4 text-center">
            {!compact && <ArrowDownTrayIcon className="size-10 text-sky-500" strokeWidth={1.5} />}
            <span className="text-sm font-medium text-sky-700 dark:text-sky-300">{label ?? t('drop.default')}</span>
          </div>
        </div>
      )}
    </div>
  );
}

/** Says, next to an upload button, that dropping works too (Components/DropHint.razor); hidden on a phone by default. */
export function DropHint({ text, className }: { text: string; className?: string }) {
  return <span className={`text-xs text-neutral-400 dark:text-neutral-500 ${className ?? 'hidden sm:inline'}`}>{text}</span>;
}
