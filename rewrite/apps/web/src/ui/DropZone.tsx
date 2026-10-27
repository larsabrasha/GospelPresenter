import { useState, type DragEvent, type ReactNode } from 'react';
import { ArrowDownTrayIcon } from './icons.tsx';

/**
 * An area that takes dropped files (Components/DropZone.razor). While files
 * hover over it, a dashed sky frame covers it with `label`; `compact` leaves
 * out the icon. `enabled` false ignores the hover, as for a user who may not
 * import; the drop still reaches `onFiles`, which decides.
 */
export function DropZone({
  label,
  onFiles,
  enabled = true,
  compact,
  className,
  children,
}: {
  label?: string;
  onFiles: (files: File[]) => void;
  enabled?: boolean;
  compact?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const [dragging, setDragging] = useState(false);
  const leave = (e: DragEvent) => {
    // Moving onto a child is not leaving the zone.
    if (!(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget))) setDragging(false);
  };
  return (
    <div
      className={`relative ${className ?? ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        if (enabled) setDragging(true);
      }}
      onDragLeave={leave}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        onFiles([...e.dataTransfer.files]);
      }}
    >
      {children}
      {dragging && (
        <div className="absolute inset-0 z-20 overflow-hidden rounded-xl border-2 border-dashed border-sky-500 bg-white/85 dark:bg-neutral-900/85 pointer-events-none">
          {/* Sticky, so the hint stays in view when the zone is taller than the window. */}
          <div className="sticky top-0 h-screen max-h-full flex flex-col items-center justify-center gap-2 px-4 text-center">
            {!compact && <ArrowDownTrayIcon className="size-10 text-sky-500" strokeWidth={1.5} />}
            {label && <span className="text-sm font-medium text-sky-700 dark:text-sky-300">{label}</span>}
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
