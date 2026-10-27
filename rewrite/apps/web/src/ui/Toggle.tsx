import type { ReactNode } from 'react';

// The live panel's switches (Components/ToggleSwitch.razor, LivePanel.razor):
// a checkbox drawn as a switch, in a row that is ringed while it is on.

/** A checkbox drawn as the current app's switch: grey, sky when on, its knob sliding over. */
export const SWITCH =
  'relative shrink-0 appearance-none w-9 h-5 p-0 m-0 border-0 rounded-full cursor-pointer bg-neutral-300 dark:bg-neutral-500 checked:bg-sky-500 transition-colors disabled:cursor-default ' +
  'before:absolute before:top-0.5 before:left-0.5 before:size-4 before:rounded-full before:bg-white before:shadow before:transition-all checked:before:left-4.5 ' +
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-1';

/** The row a switch sits in, ringed in sky while on. */
export function rowClass(on: boolean, disabled = false): string {
  return `flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm text-neutral-600 dark:text-neutral-300 ${
    on ? 'bg-sky-100 dark:bg-sky-900/30 ring-1 ring-sky-500' : 'bg-neutral-100 dark:bg-neutral-700/50'
  } ${disabled ? 'cursor-default opacity-60' : 'cursor-pointer'}`;
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
}: {
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
    <label className={rowClass(checked, disabled)}>
      <span className="flex items-center gap-2 min-w-0">
        {icon}
        <span className="min-w-0 text-left">
          <span className="block truncate">{label}</span>
          {sub && <span className="block text-[11px] text-neutral-400 dark:text-neutral-500 truncate">{sub}</span>}
        </span>
      </span>
      <span className="flex items-center gap-2 shrink-0">
        {extra}
        <input type="checkbox" className={SWITCH} aria-label={label} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      </span>
    </label>
  );
}

/** A small grey caption in capitals, as "NU VISAS" over the live preview. */
export const CAPTION = 'text-[10px] uppercase tracking-widest text-neutral-400 dark:text-neutral-500 font-semibold';
