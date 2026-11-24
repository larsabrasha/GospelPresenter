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
        className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-raised text-sm font-mono text-stone-800 dark:text-stone-100 border border-stone-200 dark:border-stone-600 select-all focus:outline-none focus:border-sky-500 focus:ring-4 focus:ring-sky-500/20"
      />
      <AppButton variant="neutral" title={copyLabel} aria-label={copyLabel} onClick={onCopy} className="px-3! py-2! rounded-full! flex items-center justify-center">
        <CopyIcon className="w-4 h-4" />
      </AppButton>
    </div>
  );
}
