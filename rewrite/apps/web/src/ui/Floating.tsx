import { useId, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { ChevronDownIcon } from './icons.tsx';

// Fields with the label inside the box, which moves up when the field has a
// value or focus (Components/FloatingInput.razor, FloatingSelect, FloatingTextarea).

const LABEL =
  'pointer-events-none absolute left-4 top-1 text-xs text-neutral-500 dark:text-neutral-400 transition-all peer-placeholder-shown:top-3.5 peer-placeholder-shown:text-sm peer-focus:top-1 peer-focus:text-xs';
const BOX = 'rounded-lg border dark:bg-neutral-700 dark:scheme-dark focus:outline-none focus:ring-2 focus:ring-inset focus:ring-sky-500';

export function FloatingInput({
  label,
  hideLabel,
  hasError,
  className,
  inputClassName,
  id,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hideLabel?: boolean; hasError?: boolean; inputClassName?: string }) {
  const own = useId();
  const inputId = id ?? own;
  const border = hasError ? 'border-red-500' : 'border-neutral-300 dark:border-neutral-600';
  return (
    <div className={`relative ${className ?? ''}`}>
      <input
        {...rest}
        id={inputId}
        placeholder={hideLabel ? label : ' '}
        aria-label={hideLabel ? label : undefined}
        className={`peer w-full h-12 px-4 ${hideLabel ? 'py-0' : 'pt-4 pb-0 placeholder-transparent'} ${BOX} ${border} disabled:opacity-50 disabled:cursor-default ${inputClassName ?? ''}`}
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
      <select {...rest} id={selectId} className={`w-full appearance-none h-12 pt-4 pb-0 px-4 pr-10 ${BOX} border-neutral-300 dark:border-neutral-600 disabled:opacity-50`}>
        {children}
      </select>
      <label htmlFor={selectId} className="pointer-events-none absolute left-4 top-1 text-xs text-neutral-500 dark:text-neutral-400">
        {label}
      </label>
      <ChevronDownIcon className="size-4 absolute right-3.5 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" />
    </div>
  );
}

export function FloatingTextarea({ label, className, id, rows = 4, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string }) {
  const own = useId();
  const areaId = id ?? own;
  return (
    <div className={`relative ${className ?? ''}`}>
      <textarea
        {...rest}
        id={areaId}
        rows={rows}
        placeholder=" "
        className={`peer w-full pt-5 px-4 pb-2 ${BOX} border-neutral-300 dark:border-neutral-600 placeholder-transparent resize-y`}
      />
      <label htmlFor={areaId} className={LABEL}>
        {label}
      </label>
    </div>
  );
}
