import type { ReactNode, SelectHTMLAttributes } from 'react';
import { AppButton } from './AppButton.tsx';
import { ChevronDownIcon, ChevronRightIcon } from './icons.tsx';
import { RED_TINT, SKY_TINT } from './glass.ts';
import { CARD } from './List.tsx';
import { SWITCH } from './Toggle.tsx';

// A page of settings as iOS's Settings and macOS's System Settings lay one out (Lars, 2026-11-02): groups of rows, a
// small grey caption over each card, hairlines between its rows, what the group does in grey under it, and no box
// around a single choice.

/** A row of a group: its name at the left, its value or control at the right. */
export const GROUP_ROW = 'flex items-center justify-between gap-3 px-4 min-h-11 py-2 text-sm';

/** An action as a row of a group, in sky, as iOS's ("Rensa cache", "Skapa inbjudningslänk"). */
export const ACTION_ROW = `${GROUP_ROW} w-full text-left text-sky-600 dark:text-sky-400 cursor-pointer hover:bg-stone-200/60 dark:hover:bg-white/[0.06] disabled:text-stone-400 dark:disabled:text-stone-500 disabled:cursor-default disabled:hover:bg-transparent`;

/** A destructive action as a group of its own, red and centred, as iOS's "Radera …". */
export const DANGER_ROW =
  `danger-row ${GROUP_ROW} w-full justify-center text-red-600 dark:text-red-400 cursor-pointer hover:bg-stone-200/60 dark:hover:bg-white/[0.06] ` +
  // Wider than a phone, a red button of its own size, as macOS's, not a row across the page (Lars, 2026-11-25); its
  // group's card goes (`Group`).
  'sm:self-start sm:w-auto sm:min-h-0 sm:h-9 sm:py-0 sm:rounded-full sm:bg-red-500/10 sm:hover:bg-red-500/16 sm:dark:bg-red-400/15 sm:dark:hover:bg-red-400/22';

/** A group's small grey caption, over its card. */
export const CAPTION = 'px-4 text-sm/5 font-semibold text-stone-500 dark:text-stone-400';

/**
 * An action under a group, with its icon ("Ladda upp fil"): a tinted pill, so one sees where it starts and ends, not
 * sky text that reads as a link (Lars, 2026-11-25).
 */
export const TEXT_ACTION = `self-start inline-flex items-center gap-1.5 h-9 touch:h-11 px-4 rounded-full text-sm cursor-pointer disabled:opacity-50 disabled:cursor-default ${SKY_TINT}`;

/** The same, small, for an action inside a row or a line of text ("Sluta spara", "Byt"). */
export const SMALL_ACTION = `shrink-0 inline-flex items-center gap-1 h-7 touch:h-9 px-3 rounded-full text-[13px] font-medium cursor-pointer disabled:opacity-50 disabled:cursor-default ${SKY_TINT}`;

/** A small red one, as Ta bort beside a login. */
export const SMALL_DANGER = `shrink-0 inline-flex items-center gap-1 h-7 touch:h-9 px-3 rounded-full text-[13px] font-medium cursor-pointer disabled:opacity-40 disabled:cursor-default ${RED_TINT}`;

export function Group({ title, footer, children }: { title?: string; footer?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} className="space-y-1.5">
      {title && <h2 className={CAPTION}>{title}</h2>}
      {/* A group of only a red action has no card where that action is a button of its own (DANGER_ROW). */}
      <div className={`${CARD} flex flex-col [&>*+*]:border-t-[0.5px] [&>*+*]:border-separator sm:has-[>.danger-row:only-child]:bg-transparent sm:has-[>.danger-row:only-child]:border-0 sm:has-[>.danger-row:only-child]:overflow-visible`}>{children}</div>
      {footer && <div className="px-4 text-xs text-stone-500 dark:text-stone-400">{footer}</div>}
    </section>
  );
}

/** A pop-up menu as macOS's at the end of a row: the chosen value in a pill, ▾ after it. */
export function PopUp({ children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    // As wide as its value, and no wider than the row has room for: a long value is cut, not past the edge.
    <span className="relative min-w-0 max-w-full">
      <select
        {...rest}
        className="appearance-none max-w-full truncate h-9 pl-4 pr-8 rounded-full tabular-nums bg-raised dark:bg-raised-2 text-stone-900 dark:text-stone-100 cursor-pointer disabled:cursor-default focus:outline-none focus:ring-2 focus:ring-sky-500"
      >
        {children}
      </select>
      <ChevronDownIcon className="size-4 absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none" />
    </span>
  );
}

/** An opening row's symbol: white on a coloured square, as Inställningar's rows have it (pages/settings/settingsLinks.ts). */
interface RowIcon {
  icon: (p: { className?: string }) => ReactNode;
  colour: string;
}

/**
 * A row that opens something, a sheet by `onClick` or a page by `href`: its symbol when it has one, its name, what it
 * holds in grey, and ›.
 */
export function OpeningRow({ label, value, onClick, href, testId, icon }: { label: string; value?: string; onClick?: () => void; href?: string; testId?: string; icon?: RowIcon }) {
  return (
    <AppButton
      variant="plain"
      {...(href ? { href } : { onClick })}
      data-testid={testId}
      className={`${GROUP_ROW} w-full text-left no-underline text-inherit cursor-pointer hover:bg-stone-200/60 dark:hover:bg-white/[0.06]`}
    >
      <span className="shrink-0 flex items-center gap-3">
        {icon && (
          <span className={`shrink-0 size-7 rounded-md flex items-center justify-center text-white ${icon.colour}`}>
            <icon.icon className="size-4" />
          </span>
        )}
        {label}
      </span>
      <span className="flex-1 min-w-0 flex items-center justify-end gap-2 text-stone-500 dark:text-stone-400">
        {value && <span className="truncate tabular-nums">{value}</span>}
        <ChevronRightIcon className="size-4 shrink-0 text-stone-400 dark:text-stone-600" />
      </span>
    </AppButton>
  );
}

/** A setting that is on or off: a row of its group, with what it does in grey under its name. */
export function SwitchRow({ title, description, checked, disabled, onChange }: { title: string; description?: string; checked: boolean; disabled?: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className={`${GROUP_ROW} ${disabled ? 'cursor-default' : 'cursor-pointer'}`}>
      <span>
        <span className="block">{title}</span>
        {description && <span className="block text-xs text-stone-500 dark:text-stone-400 mt-0.5">{description}</span>}
      </span>
      <input type="checkbox" role="switch" className={SWITCH} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}
