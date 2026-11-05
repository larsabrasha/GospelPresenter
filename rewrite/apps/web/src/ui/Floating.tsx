import { useId, useLayoutEffect, useRef, type InputHTMLAttributes, type Ref, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { ChevronDownIcon } from './icons.tsx';

// Fields with the label inside the box, which moves up when the field has a
// value or focus (Components/FloatingInput.razor, FloatingSelect, FloatingTextarea).

const LABEL =
  'pointer-events-none absolute left-4 top-1 text-xs text-stone-500 dark:text-stone-400 transition-all peer-placeholder-shown:top-3.5 peer-placeholder-shown:text-sm peer-focus:top-1 peer-focus:text-xs';
const BOX = 'rounded-lg border dark:bg-raised dark:scheme-dark focus:outline-none focus:border-sky-500 focus:ring-4 focus:ring-sky-500/20';

export function FloatingInput({
  label,
  hideLabel,
  hasError,
  bare,
  className,
  inputClassName,
  id,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & {
  ref?: Ref<HTMLInputElement>;
  label: string;
  hideLabel?: boolean;
  hasError?: boolean;
  /** A row of a card of fields (ui/Group.tsx): no box of its own, its name still moving up as it is typed in. */
  bare?: boolean;
  inputClassName?: string;
}) {
  const own = useId();
  const inputId = id ?? own;
  const border = hasError ? 'border-red-500' : 'border-stone-200 dark:border-stone-600';
  const box = bare ? 'bg-transparent outline-none dark:scheme-dark' : `${BOX} ${border}`;
  return (
    <div className={`relative ${className ?? ''}`}>
      <input
        {...rest}
        id={inputId}
        placeholder={hideLabel ? label : ' '}
        aria-label={hideLabel ? label : undefined}
        className={`peer w-full h-12 px-4 ${hideLabel ? 'py-0' : 'pt-4 pb-0 placeholder-transparent'} ${box} disabled:opacity-50 disabled:cursor-default ${inputClassName ?? ''}`}
      />
      {!hideLabel && (
        <label htmlFor={inputId} className={LABEL}>
          {label}
        </label>
      )}
    </div>
  );
}

export function FloatingSelect({ label, className, id, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { label: string }) {
  const own = useId();
  const selectId = id ?? own;
  return (
    <div className={`relative ${className ?? ''}`}>
      <select {...rest} id={selectId} className={`w-full appearance-none h-12 pt-4 pb-0 px-4 pr-10 ${BOX} border-stone-200 dark:border-stone-600 disabled:opacity-50`}>
        {children}
      </select>
      <label htmlFor={selectId} className="pointer-events-none absolute left-4 top-1 text-xs text-stone-500 dark:text-stone-400">
        {label}
      </label>
      <ChevronDownIcon className="size-4 absolute right-3.5 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none" />
    </div>
  );
}

/** A text area with its label in the box; `bare` has no box of its own, for text written straight into a card. */
/** Whether the browser sizes a field to its text itself (`field-sizing: content`); else `useGrow` does. */
const SIZES_ITSELF = typeof CSS !== 'undefined' && CSS.supports('field-sizing', 'content');

/** As tall as its text, as iOS's text views grow (Lars, 2026-11-04), where the browser does not do it itself. */
function useGrow(on: boolean) {
  const area = useRef<HTMLTextAreaElement>(null);
  // After every render, as the text may have changed with it.
  useLayoutEffect(() => {
    const el = area.current;
    if (!on || SIZES_ITSELF || !el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  });
  return area;
}

/**
 * A `bare` field (a song part's text) grows with its text, from three lines, and has no handle to size it. `hideLabel`
 * puts the label in the field as its placeholder, as FloatingInput's.
 */
export function FloatingTextarea({ label, className, id, rows = 4, bare, hideLabel, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; bare?: boolean; hideLabel?: boolean }) {
  const own = useId();
  const areaId = id ?? own;
  const area = useGrow(!!bare);
  return (
    <div className={`relative ${className ?? ''}`}>
      <textarea
        {...rest}
        ref={area}
        id={areaId}
        rows={bare ? 3 : rows}
        placeholder={hideLabel ? label : ' '}
        aria-label={hideLabel ? label : rest['aria-label']}
        className={
          bare
            ? 'block w-full px-4 py-3 bg-transparent border-0 outline-none resize-none [field-sizing:content] min-h-[calc(3lh+1.5rem)] overflow-hidden text-[15px]/6 text-stone-900 dark:text-stone-100'
            : `peer w-full ${hideLabel ? 'py-3' : 'pt-5 pb-2 placeholder-transparent'} px-4 ${BOX} border-stone-200 dark:border-stone-600 resize-y`
        }
      />
      {!hideLabel && (
        <label htmlFor={areaId} className={LABEL}>
          {label}
        </label>
      )}
    </div>
  );
}
