import type { ReactNode } from 'react';

// The live panel's switches (Components/ToggleSwitch.razor, LivePanel.razor):
// a checkbox drawn as a switch, in a row that is ringed while it is on.

/** A checkbox drawn as the current app's switch: grey, sky when on, its knob sliding over. */
export const SWITCH =
  'relative shrink-0 appearance-none w-9 h-5 p-0 m-0 border-0 rounded-full cursor-pointer bg-stone-300 dark:bg-stone-500 checked:bg-sky-500 transition-colors disabled:cursor-default ' +
  'before:absolute before:top-0.5 before:left-0.5 before:size-4 before:rounded-full before:bg-white before:shadow before:transition-all checked:before:left-4.5 ' +
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-1';

/** A checkbox drawn as iOS's switch, for the 2.0 lists (docs/layout-2-0.md): green when on, a 51×31 pt track. */
export const IOS_SWITCH =
  'relative shrink-0 appearance-none w-[51px] h-[31px] p-0 m-0 border-0 rounded-full cursor-pointer bg-raised-2 checked:bg-green-500 transition-colors disabled:cursor-default disabled:opacity-50 ' +
  'before:absolute before:top-0.5 before:left-0.5 before:size-[27px] before:rounded-full before:bg-white before:shadow before:transition-all checked:before:left-[22px] ' +
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-1';

/** The row a switch sits in, ringed in sky while on; a `cell` of a group (PanelGroup) plain, its switch saying it. */
function rowClass(on: boolean, disabled = false, cell = false): string {
  const look = cell
    ? 'min-h-11 py-1.5 text-stone-700 dark:text-stone-200'
    : `py-2 touch:min-h-11 rounded-lg text-stone-600 dark:text-stone-300 ${on ? 'bg-sky-100 dark:bg-sky-900/30 ring-1 ring-sky-500' : 'bg-stone-100 dark:bg-raised/50'}`;
  return `flex items-center justify-between gap-2 px-3 text-sm ${look} ${disabled ? 'cursor-default opacity-60' : 'cursor-pointer'}`;
}

/**
 * A switch row: the whole row is the label, the checkbox at its end is named
 * by `label` alone, and `extra` (a count, a state) goes before the switch.
 */
export function ToggleRow({
  label,
  checked,
  disabled,
  onChange,
  icon,
  extra,
  sub,
  noSwitch,
  title,
  cell,
  warn,
}: {
  /** A row of a group's card (PanelGroup): no box of its own. */
  cell?: boolean;
  /** `sub` in orange: something that should be on is gone. */
  warn?: boolean;
  /** A tooltip on the row, as an overlay's full title (LivePanel.razor). */
  title?: string;
  /** No switch at all, as a saved screen whose page is not open (LivePanel.razor). */
  noSwitch?: boolean;
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (on: boolean) => void;
  icon?: ReactNode;
  extra?: ReactNode;
  /** A small grey line under the name. */
  sub?: ReactNode;
}) {
  return (
    <label className={rowClass(checked, disabled, cell)} title={title}>
      <span className="flex items-center gap-2 min-w-0">
        {icon}
        <span className="min-w-0 text-left">
          <span className="block truncate">{label}</span>
          {sub && <span className={`block text-[11px] truncate ${warn ? 'text-orange-500' : 'text-stone-400 dark:text-stone-500'}`}>{sub}</span>}
        </span>
      </span>
      <span className="flex items-center gap-2 shrink-0">
        {extra}
        <input type="checkbox" className={`${SWITCH} ${noSwitch ? 'hidden' : ''}`} aria-label={label} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      </span>
    </label>
  );
}

/** A small grey caption in capitals, as "NU VISAS" over the live preview. */
export const CAPTION = 'text-[10px] uppercase tracking-widest text-stone-400 dark:text-stone-500 font-semibold';
