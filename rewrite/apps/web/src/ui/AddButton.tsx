import type { ReactElement, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AppButton } from './AppButton.tsx';
import { PlusIcon } from './icons.tsx';
import { FLOATING_PRIMARY, LIFTED } from './glass.ts';
import { useHeaderFloat } from './headerFloat.ts';

/**
 * The round + of a heading row (docs/layout-2-0.md): how every page that lists something adds to it, as iOS 27 puts
 * "new" by a list's title. Filled in the app's blue, so it is seen (Lars, 2026-11-02), and flat, as it sits in the page.
 */
const ROUND_ADD = 'size-11 shrink-0 rounded-full flex items-center justify-center cursor-pointer bg-sky-500 hover:bg-sky-600 text-white';

/** In Inställningar the heading row's + floats at the column's bottom right, as iOS 26 puts "new" (Lars, 2026-11-02). */
const FLOATING_ADD = `size-14 shrink-0 rounded-full flex items-center justify-center cursor-pointer ${FLOATING_PRIMARY}`;

/**
 * A second button beside the +, a capsule with its icon and word, as iOS 26's floating buttons: white and lifted where
 * it floats, grey in the row; seen, but not the first.
 */
const ROUND_SECONDARY = 'h-11 px-4 gap-2 shrink-0 rounded-full flex items-center justify-center cursor-pointer text-sm font-medium bg-raised hover:bg-raised-2 text-sky-600 dark:text-sky-400 disabled:cursor-default disabled:opacity-50';
const FLOATING_SECONDARY = `h-14 px-5 gap-2 shrink-0 rounded-full flex items-center justify-center cursor-pointer text-[15px] font-medium text-sky-600 dark:text-sky-400 disabled:cursor-default disabled:opacity-50 ${LIFTED}`;

/** The + of a heading row, in it or floating: `render` draws it with the classes for where it is. */
export function useRoundAdd(render: (className: string) => ReactElement, secondary = false) {
  const float = useHeaderFloat();
  if (float) return createPortal(render(secondary ? FLOATING_SECONDARY : FLOATING_ADD), float);
  return render(secondary ? ROUND_SECONDARY : ROUND_ADD);
}

/** A round + named `label` for screen readers and as its tooltip. */
export function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return useRoundAdd((className) => (
    <AppButton variant="plain" aria-label={label} title={label} onClick={onClick} className={className}>
      <PlusIcon className="size-5" strokeWidth={2.25} />
    </AppButton>
  ));
}


/** A capsule beside the + of a heading row, floating with it in Inställningar (Sånger's Importera); `title` is its tooltip. */
export function RoundButton({ text, title, icon, disabled, onClick }: { text: string; title: string; icon: ReactNode; disabled?: boolean; onClick: () => void }) {
  return useRoundAdd(
    (className) => (
      <AppButton variant="plain" title={title} disabled={disabled} onClick={onClick} className={className}>
        {icon}
        {text}
      </AppButton>
    ),
    true,
  );
}
