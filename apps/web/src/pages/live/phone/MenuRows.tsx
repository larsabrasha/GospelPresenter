import { Children, type ReactNode } from 'react';
import { AppButton } from '../../../ui/AppButton.tsx';
import { ICON_GROUP, useSheetDismiss } from '../../../ui/Sheet.tsx';

/** A row of a sheet's menu. */
const ROW = 'w-full min-h-12 px-4 flex items-center gap-3.5 text-[17px] text-left cursor-pointer';

/** One rounded group of rows; with no row in it (each is conditional) it takes no room. */
export function MenuGroup({ children }: { children: ReactNode }) {
  if (!Children.toArray(children).length) return null;
  return <div className={ICON_GROUP}>{children}</div>;
}

/** A choice in a sheet's menu, its icon first, as iOS 27 draws them; choosing it closes the sheet. */
export function MenuRow({ icon, onClick, danger, disabled, children }: { icon?: ReactNode; onClick: () => void; danger?: boolean; disabled?: boolean; children: ReactNode }) {
  // The choice is carried out at once, as the sheet slides away (ui/Sheet.tsx).
  const dismiss = useSheetDismiss();
  return (
    <AppButton variant="plain" onClick={() => dismiss(onClick)} disabled={disabled} className={`${ROW} ${danger ? 'text-red-500' : ''} disabled:text-stone-400 disabled:cursor-default disabled:text-[15px]`}>
      {icon && <span className={`shrink-0 flex ${danger || disabled ? '' : 'text-stone-500 dark:text-stone-400'}`}>{icon}</span>}
      <span>{children}</span>
    </AppButton>
  );
}
