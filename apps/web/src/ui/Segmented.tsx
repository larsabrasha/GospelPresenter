import { AppButton } from './AppButton.tsx';

/**
 * A choice of a few, as words in a segmented control (Photos', Finder's), the one chosen raised: the start page's Lista,
 * Kalender and Tabell (Lars, 2026-11-27). ViewPicker is its sibling with icons.
 */
export function Segmented<K extends string>({ label, options, value, onChange }: { label: string; options: { key: K; label: string }[]; value: K; onChange: (key: K) => void }) {
  return (
    <span className="flex w-fit shrink-0 rounded-full bg-stone-200/80 dark:bg-raised p-0.5" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <AppButton
          key={o.key}
          variant="plain"
          role="radio"
          aria-checked={value === o.key}
          className={`h-8 touch:h-9 px-4 text-sm flex items-center justify-center rounded-full cursor-pointer ${value === o.key ? 'bg-white dark:bg-raised-2 shadow-sm font-semibold text-stone-800 dark:text-stone-100' : 'text-stone-600 dark:text-stone-300'}`}
          onClick={() => onChange(o.key)}
        >
          {o.label}
        </AppButton>
      ))}
    </span>
  );
}
