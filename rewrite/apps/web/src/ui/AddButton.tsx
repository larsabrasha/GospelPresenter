import { AppButton } from './AppButton.tsx';
import { PlusIcon } from './icons.tsx';
import { SKY_SHADOW } from './glass.ts';

/**
 * The round + of a heading row (docs/layout-2-0.md): how every page that lists something adds to it, as iOS 27 puts
 * "new" by a list's title. Tinted in the app's blue rather than filled, so it is seen without taking the eye.
 */
export const ROUND_ADD = `size-11 shrink-0 rounded-full flex items-center justify-center cursor-pointer bg-sky-50 text-sky-500 hover:bg-sky-100 dark:bg-sky-900/30 dark:text-sky-400 dark:hover:bg-sky-900/50 ${SKY_SHADOW}`;

/** A round + named `label` for screen readers and as its tooltip. */
export function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <AppButton variant="plain" aria-label={label} title={label} onClick={onClick} className={ROUND_ADD}>
      <PlusIcon className="size-5" strokeWidth={2.25} />
    </AppButton>
  );
}
