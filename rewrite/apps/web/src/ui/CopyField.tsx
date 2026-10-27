import type { Ref } from 'react';
import { AppButton } from './AppButton.tsx';
import { CopyIcon } from './icons.tsx';

/**
 * A link to copy (Displays.razor's dialogs): the link in a grey mono field,
 * selected on focus, and a square copy button with two sheets. `copyLabel`
 * names the button for screen readers and as its tooltip.
 */
export function CopyField({ value, label, copyLabel, onCopy, inputRef }: { value: string; label: string; copyLabel: string; onCopy: () => void; inputRef?: Ref<HTMLInputElement> }) {
  return (
    <div className="flex items-stretch gap-2">
      <input
        ref={inputRef}
        type="text"
        readOnly
        value={value}
        aria-label={label}
        onFocus={(e) => e.currentTarget.select()}
        className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-neutral-100 dark:bg-neutral-700 text-sm font-mono text-neutral-800 dark:text-neutral-100 border border-neutral-200 dark:border-neutral-600 select-all focus:outline-none focus:ring-2 focus:ring-sky-500"
      />
      <AppButton variant="neutral" title={copyLabel} aria-label={copyLabel} onClick={onCopy} className="px-3! py-2! rounded-lg! flex items-center justify-center">
        <CopyIcon className="w-4 h-4" />
      </AppButton>
    </div>
  );
}
