import type { Overlay, PresentationItem } from '@gp/core';
import { useDb } from '../../../db/react.tsx';
import { t } from '../../../i18n.ts';
import { AppButton } from '../../../ui/AppButton.tsx';
import { useSaveFailed } from '../../../ui/AutoSave.tsx';
import { afterWrite } from '../../../ui/debounce.ts';
import { Dropdown, MENU_ITEM } from '../../../ui/Dropdown.tsx';
import { CheckIcon, EllipsisIcon, PencilIcon } from '../../../ui/icons.tsx';

/**
 * An item's … on its heading in the middle column (Lars, 2026-11-02): Redigera, and the overlay it carries, quieter
 * than a button and a select under every heading. The overlay chosen shows beside the heading (OverlayChip).
 */
export function ItemMenu({
  item,
  overlays,
  editHref,
  onEditImages,
}: {
  item: PresentationItem;
  overlays: Overlay[];
  /** A song's page, opened alone in Inställningar. */
  editHref?: string;
  /** A picture item's order and removal, in place. */
  onEditImages?: () => void;
}) {
  const db = useDb();
  const saveFailed = useSaveFailed();
  const choose = (overlayId: string | null) => afterWrite(db.mutate('setItemOverlay', { itemId: item.id, overlayId }), () => {}, saveFailed);
  if (!editHref && !onEditImages && !overlays.length) return null;
  const choices = [{ id: '', title: t('overlays.itemNone') }, ...overlays.map((o) => ({ id: o.id, title: o.title }))];
  return (
    <Dropdown
      // Beside the heading's words rather than at the far right (Lars, 2026-11-02), its menu opening from there.
      className="normal-case tracking-normal font-normal"
      menuClassName="w-56 left-0! right-auto!"
      button={{ className: 'size-7 rounded-full flex items-center justify-center cursor-pointer text-stone-500 hover:bg-raised', 'aria-label': t('presentation.itemOptions', { title: item.title }), title: t('presentation.itemOptions', { title: item.title }) }}
      trigger={<EllipsisIcon className="size-4" />}
    >
      {editHref && (
        <AppButton variant="plain" role="menuitem" href={editHref} className={MENU_ITEM}>
          <PencilIcon className="size-4" />
          {t('presentation.editSong')}
        </AppButton>
      )}
      {onEditImages && (
        <AppButton variant="plain" role="menuitem" className={MENU_ITEM} onClick={onEditImages}>
          <PencilIcon className="size-4" />
          {t('presentation.editImages')}
        </AppButton>
      )}
      {!!overlays.length && (
        <div role="group" aria-label={t('overlays.itemOverlay')} className={editHref || onEditImages ? 'border-t-[0.5px] border-separator' : ''}>
          <p className="px-4 pt-2 pb-1 text-xs font-semibold text-stone-500 dark:text-stone-400">{t('overlays.itemOverlay')}</p>
          {choices.map((c) => (
            <AppButton
              key={c.id}
              variant="plain"
              role="menuitemradio"
              aria-checked={(item.overlayId ?? '') === c.id}
              data-overlay={c.id}
              className={MENU_ITEM}
              // Read from the row, so what is chosen is what the row names.
              onClick={(e) => choose(e.currentTarget.dataset.overlay || null)}
            >
              <span className="size-4 shrink-0">{(item.overlayId ?? '') === c.id && <CheckIcon className="size-4 text-sky-500" />}</span>
              <span className="truncate">{c.title}</span>
            </AppButton>
          ))}
        </div>
      )}
    </Dropdown>
  );
}

/** The overlay an item carries, beside its heading, so it shows without opening the …. */
export function OverlayChip({ item, overlays }: { item: PresentationItem; overlays: Overlay[] }) {
  const overlay = item.overlayId ? overlays.find((o) => o.id === item.overlayId) : undefined;
  if (!overlay) return null;
  return (
    <span className="shrink-0 px-2 py-0.5 rounded-full text-[11px] normal-case tracking-normal font-medium bg-indigo-500/12 text-indigo-600 dark:text-indigo-300" title={t('overlays.itemOverlay')}>
      {overlay.title}
    </span>
  );
}
