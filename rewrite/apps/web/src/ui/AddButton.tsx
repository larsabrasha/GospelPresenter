import type { ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { AppButton } from './AppButton.tsx';
import { PlusIcon } from './icons.tsx';
import { FLOATING_PRIMARY } from './glass.ts';
import { useHeaderFloat } from './headerFloat.ts';

/**
 * The round + of a heading row (docs/layout-2-0.md): how every page that lists something adds to it, as iOS 27 puts
 * "new" by a list's title. Filled in the app's blue, so it is seen (Lars, 2026-11-02), and flat, as it sits in the page.
 */
const ROUND_ADD = 'size-11 shrink-0 rounded-full flex items-center justify-center cursor-pointer bg-sky-500 hover:bg-sky-600 text-white';

/** In Inställningar the heading row's + floats at the column's bottom right, as iOS 26 puts "new" (Lars, 2026-11-02). */
const FLOATING_ADD = `size-14 shrink-0 rounded-full flex items-center justify-center cursor-pointer ${FLOATING_PRIMARY}`;

/** The + of a heading row, in it or floating: `render` draws it with the classes for where it is. */
export function useRoundAdd(render: (className: string) => ReactElement) {
  const float = useHeaderFloat();
  return float ? createPortal(render(FLOATING_ADD), float) : render(ROUND_ADD);
}

/** A round + named `label` for screen readers and as its tooltip. */
export function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return useRoundAdd((className) => (
    <AppButton variant="plain" aria-label={label} title={label} onClick={onClick} className={className}>
      <PlusIcon className="size-5" strokeWidth={2.25} />
    </AppButton>
  ));
}
