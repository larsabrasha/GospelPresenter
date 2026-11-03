import { createContext, useContext, type ReactNode } from 'react';

// The live panel's switches (Components/ToggleSwitch.razor, LivePanel.razor):
// a checkbox drawn as a switch, in a row that is ringed while it is on.

/** A checkbox drawn as the current app's switch: grey, sky when on, its knob sliding over. */
export const SWITCH =
  'relative shrink-0 appearance-none w-9 h-5 p-0 m-0 border-0 rounded-full cursor-pointer bg-stone-300 dark:bg-stone-500 checked:bg-sky-500 transition-colors disabled:cursor-default ' +
  'before:absolute before:top-0.5 before:left-0.5 before:size-4 before:rounded-full before:bg-white before:shadow before:transition-all checked:before:left-4.5 ' +
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-1';

/** A checkbox drawn as iOS's switch, for the 2.0 lists (docs/layout-2-0.md): green when on, a 51×31 pt track. */
const IOS_SWITCH =
  'relative shrink-0 appearance-none w-[51px] h-[31px] p-0 m-0 border-0 rounded-full cursor-pointer bg-raised-2 checked:bg-green-500 transition-colors disabled:cursor-default disabled:opacity-50 ' +
  'before:absolute before:top-0.5 before:left-0.5 before:size-[27px] before:rounded-full before:bg-white before:shadow before:transition-all checked:before:left-[22px] ' +
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-1';

/**
 * Rows of a sheet's card (a phone's Utgångar and Overlays), drawn as iOS's: 17 pt text, 48 pt rows and its own switch,
 * as the item sheet's rows are (Lars, 2026-11-02: the sheets looked off beside each other); their icons 20 px with
 * 14 px to the text, as the item sheet's too (Lars, 2026-11-03).
 */
export const SheetRows = createContext(false);

/** The row a switch sits in, ringed in sky while on; a `cell` of a group (PanelGroup) plain, its switch saying it. */
function rowClass(on: boolean, disabled = false, cell = false, big = false): string {
  const look = big
    ? 'min-h-12 py-2 text-[17px] text-stone-900 dark:text-stone-100'
    : cell
    ? 'min-h-11 py-1.5 text-stone-700 dark:text-stone-200'
    : `py-2 touch:min-h-11 rounded-lg text-stone-600 dark:text-stone-300 ${on ? 'bg-sky-100 dark:bg-sky-900/30 ring-1 ring-sky-500' : 'bg-stone-100 dark:bg-raised/50'}`;
  return `flex items-center justify-between gap-2 ${big ? 'px-4' : 'px-3 text-sm'} ${look} ${disabled ? 'cursor-default opacity-60' : 'cursor-pointer'}`;
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
  const big = useContext(SheetRows);
  return (
    <label className={rowClass(checked, disabled, cell, big)} title={title}>
      <span className={`flex items-center min-w-0 ${big ? 'gap-3.5' : 'gap-2'}`}>
        {big && icon ? <span className="shrink-0 flex [&>svg]:size-5">{icon}</span> : icon}
        <span className="min-w-0 text-left">
          <span className="block truncate">{label}</span>
          {sub && <span className={`block ${big ? 'text-[13px]' : 'text-[11px]'} truncate ${warn ? 'text-orange-500' : 'text-stone-400 dark:text-stone-500'}`}>{sub}</span>}
        </span>
      </span>
      <span className="flex items-center gap-2 shrink-0">
        {extra}
        <input type="checkbox" className={`${big ? IOS_SWITCH : SWITCH} ${noSwitch ? 'hidden' : ''}`} aria-label={label} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      </span>
    </label>
  );
}
