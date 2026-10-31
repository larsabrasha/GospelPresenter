import type { ReactNode } from 'react';
import { CheckIcon } from '../ui/icons.tsx';
import { RemoveMenu } from '../ui/RemoveMenu.tsx';

/**
 * A file in the add dialog's Ljud or Video tab: a click, Enter or space picks it or puts it back, the file's icon
 * turning into a sky tick; its menu removes it from the library. `nav` is the roving list's `item(i)`.
 */
export function PickableFileRow({ nav, picked, name, icon, onToggle, onRemove, children }: { nav: object; picked: boolean; name: string; icon: ReactNode; onToggle: () => void; onRemove: () => void; children?: ReactNode }) {
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
      className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition ring-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${
        picked ? 'ring-sky-500 bg-sky-50 dark:bg-sky-900/20' : 'ring-transparent hover:bg-neutral-100 dark:hover:bg-neutral-700'
      }`}
    >
      {picked ? (
        <span className="size-5 flex items-center justify-center rounded-full bg-sky-500 text-white shrink-0">
          <CheckIcon className="size-4" />
        </span>
      ) : (
        icon
      )}
      {children}
      <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
        <RemoveMenu name={name} on="row" onRemove={onRemove} />
      </span>
    </li>
  );
}
