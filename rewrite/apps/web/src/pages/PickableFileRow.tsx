import type { ReactNode } from 'react';
import { CheckIcon } from '../ui/icons.tsx';
import { RemoveMenu } from '../ui/RemoveMenu.tsx';

/**
 * A file in the add dialog's Ljud or Video tab: a click, Enter or space picks it or puts it back, the file's icon
 * turning into a sky tick; its menu removes it from the library. `nav` is the roving list's `item(i)`.
 */
/** `tile`: a grid's or the large view's tile (ui/ViewPicker.tsx), its picture over its name, the tick and the menu over the picture. */
export function PickableFileRow({ nav, picked, name, icon, onToggle, onRemove, tile, children }: { nav: object; picked: boolean; name: string; icon: ReactNode; onToggle: () => void; onRemove: () => void; tile?: boolean; children?: ReactNode }) {
  return (
    <li
      {...nav}
      role="button"
      aria-pressed={picked}
      aria-label={name}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ') || e.ctrlKey || e.metaKey) return;
        e.preventDefault();
        onToggle();
      }}
      className={`${tile ? 'relative flex flex-col gap-1 p-1.5' : 'flex items-center gap-3 px-3 py-2'} rounded-lg cursor-pointer transition ring-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${
        picked ? 'ring-sky-500 bg-sky-50 dark:bg-sky-900/20' : 'ring-transparent hover:bg-stone-200/60 dark:hover:bg-white/[0.06]'
      }`}
    >
      {picked ? (
        <span className={`size-5 flex items-center justify-center rounded-full bg-sky-500 text-white shrink-0 ${tile ? 'absolute top-3 left-3 z-10' : ''}`}>
          <CheckIcon className="size-4" />
        </span>
      ) : (
        !tile && icon
      )}
      {children}
      <span className={tile ? 'absolute top-2 right-2 z-10' : undefined} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
        <RemoveMenu name={name} onRemove={onRemove} />
      </span>
    </li>
  );
}
