import { t } from '../../i18n.ts';
import { Dropdown } from '../../ui/Dropdown.tsx';
import { FLOATING_PRIMARY } from '../../ui/glass.ts';
import { PlusIcon } from '../../ui/icons.tsx';
import { AddChoices } from '../live/AddChoices.tsx';
import type { AddChoice } from './AddItemDialog.tsx';

/**
 * The running order's + when the sidebar is folded away on a computer (Lars, 2026-11-07): round and blue at the
 * middle's foot on the right, as a phone has it, with the same menu as the sidebar's Lägg till. Clear of the live
 * column while it is out, and above its own toggle while it is folded.
 */
export function FloatingAdd({ onChoose, liveColumn }: { onChoose: (choice: AddChoice) => void; liveColumn: 'none' | 'open' | 'folded' }) {
  const place = liveColumn === 'open' ? 'right-[356px] bottom-safe-4' : liveColumn === 'folded' ? 'right-4 bottom-[calc(env(safe-area-inset-bottom)+4.5rem)]' : 'right-4 bottom-safe-4';
  // Placed by a box of its own: the menu's own box is `relative`, for the menu under it.
  return (
    <div className={`float-in absolute z-10 ${place}`}>
      <Dropdown
        menuClassName="w-56 p-1.5 rounded-xl!"
        button={{ 'aria-label': t('live.add'), title: t('live.add'), className: `size-14 rounded-full flex items-center justify-center cursor-pointer ${FLOATING_PRIMARY}` }}
        trigger={<PlusIcon className="size-6" strokeWidth={2.25} />}
      >
        <AddChoices onChoose={onChoose} />
      </Dropdown>
    </div>
  );
}
