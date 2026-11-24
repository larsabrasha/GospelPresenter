import { useRef, useState, type PointerEvent, type ReactNode, type SyntheticEvent } from 'react';
import { t } from '../i18n.ts';
import { AppButton } from './AppButton.tsx';
import { CONTEXT_ROW, ContextMenu } from './ContextMenu.tsx';
import { Dropdown, MENU_ITEM_DANGER } from './Dropdown.tsx';
import { EllipsisIcon, TrashIcon } from './icons.tsx';

/** A file's "Fler val för …" menu with Radera (Images.razor), grey in a list's row. */
export function RemoveMenu({ name, onRemove }: { name: string; onRemove: () => void }) {
  return (
    <Dropdown
      menuClassName="min-w-36"
      button={{ className: 'size-7 flex items-center justify-center rounded-full text-stone-400 hover:text-stone-600 dark:hover:text-stone-300 cursor-pointer', 'aria-label': t('images.more', { name }) }}
      trigger={<EllipsisIcon className="size-4" />}
    >
      <AppButton variant="plain" role="menuitem" className={MENU_ITEM_DANGER} onClick={onRemove}>
        <TrashIcon className="size-4" />
        {t('images.remove')}
      </AppButton>
    </Dropdown>
  );
}

/** How long a finger holds still on a picture before its menu opens, and how far it may move meanwhile. */
const HOLD_MS = 500;
const HOLD_SLOP = 10;

/** A picture's menu as Photos opens one (Lars, 2026-11-03: no … on the picture), with Radera in it. */
export function PictureMenu({ name, onRemove, children }: { name: string; onRemove: () => void; children: ReactNode }) {
  return (
    <HoldMenu label={t('images.more', { name })} menu={<RemoveRow onRemove={onRemove} />}>
      {children}
    </HoldMenu>
  );
}

/** Radera, red, in a HoldMenu. */
function RemoveRow({ onRemove }: { onRemove: () => void }) {
  return (
    <AppButton variant="plain" role="menuitem" className={`${CONTEXT_ROW} text-red-600 dark:text-red-400`} onClick={onRemove}>
      <TrashIcon className="size-4" strokeWidth={1.5} />
      {t('images.remove')}
    </AppButton>
  );
}

/**
 * An item's menu as iOS and macOS open one: a right click, the keyboard's menu key, or a finger held still on it opens
 * `menu` at that point. Presses in the menu itself, which reach here through React's tree from its portal, are left
 * alone; the click a held finger makes as it lifts is not a click on the item.
 */
export function HoldMenu({ label, menu, className, children }: { label: string; menu: ReactNode; className?: string; children: ReactNode }) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const start = useRef<{ x: number; y: number } | null>(null);
  /** A hold opened the menu: the click its finger lifting makes is not a click on the picture. */
  const held = useRef(false);
  const mine = (e: SyntheticEvent) => e.currentTarget.contains(e.target as Node);
  const cancel = () => {
    clearTimeout(timer.current);
    start.current = null;
  };
  return (
    <div
      className={`[-webkit-touch-callout:none] ${className ?? ''}`}
      onContextMenu={(e) => {
        if (!mine(e)) return;
        e.preventDefault();
        // From the keyboard there is no point: the picture's corner.
        const r = e.currentTarget.getBoundingClientRect();
        setAt(e.clientX || e.clientY ? { x: e.clientX, y: e.clientY } : { x: r.left + 8, y: r.top + 8 });
      }}
      onPointerDown={(e: PointerEvent) => {
        if (!mine(e) || e.pointerType !== 'touch') return;
        held.current = false;
        start.current = { x: e.clientX, y: e.clientY };
        timer.current = setTimeout(() => {
          held.current = true;
          setAt(start.current);
        }, HOLD_MS);
      }}
      onPointerMove={(e) => {
        if (start.current && Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > HOLD_SLOP) cancel();
      }}
      onPointerUp={cancel}
      onPointerCancel={cancel}
      onClickCapture={(e) => {
        if (!mine(e) || !held.current) return;
        held.current = false;
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      {children}
      {at && (
        <ContextMenu at={at} label={label} onClose={() => setAt(null)}>
          {menu}
        </ContextMenu>
      )}
    </div>
  );
}
