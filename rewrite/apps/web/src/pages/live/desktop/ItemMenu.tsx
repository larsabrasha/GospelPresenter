import type { Overlay, PresentationItem, SongArrangement } from '@gp/core';
import { useDb } from '../../../db/react.tsx';
import { t } from '../../../i18n.ts';
import { AppButton } from '../../../ui/AppButton.tsx';
import { useSaveFailed } from '../../../ui/AutoSave.tsx';
import { afterWrite } from '../../../ui/debounce.ts';
import { Dropdown, MENU_ITEM } from '../../../ui/Dropdown.tsx';
import { CheckIcon, EllipsisIcon, PencilIcon } from '../../../ui/icons.tsx';

/** A group of choices in the menu, the chosen one ticked: an arrangement, an overlay. */
function ChoiceGroup({ label, choices, chosen, divided, onChoose }: { label: string; choices: { id: string; title: string }[]; chosen: string; divided: boolean; onChoose: (id: string) => void }) {
  return (
    <div role="group" aria-label={label} className={divided ? 'border-t-[0.5px] border-separator' : ''}>
      <p className="px-4 pt-2 pb-1 text-xs font-semibold text-stone-500 dark:text-stone-400">{label}</p>
      {choices.map((c) => (
        <AppButton
          key={c.id}
          variant="plain"
          role="menuitemradio"
          aria-checked={chosen === c.id}
          data-choice={c.id}
          className={MENU_ITEM}
          // Read from the row, so what is chosen is what the row names.
          onClick={(e) => onChoose(e.currentTarget.dataset.choice ?? '')}
        >
          <span className="size-4 shrink-0">{chosen === c.id && <CheckIcon className="size-4 text-sky-500" />}</span>
          <span className="truncate">{c.title}</span>
        </AppButton>
      ))}
    </div>
  );
}

/**
 * An item's … on its heading in the middle column (Lars, 2026-11-02): Redigera; a song's arrangement, when it has two
 * or more, chosen here rather than in plain sight (it is chosen when the song is added; here to change it); and the
 * overlay it carries, quieter than a button and a select under every heading. The overlay chosen shows beside the
 * heading (OverlayChip).
 */
export function ItemMenu({
  item,
  overlays,
  arrangements = [],
  editHref,
  onEditImages,
}: {
  item: PresentationItem;
  overlays: Overlay[];
  /** A song's arrangements, in their order; a choice only with two or more. */
  arrangements?: SongArrangement[];
  /** A song's page, opened alone in Inställningar. */
  editHref?: string;
  /** A picture item's order and removal, in place. */
  onEditImages?: () => void;
}) {
  const db = useDb();
  const saveFailed = useSaveFailed();
  const failing = (write: Promise<void>) => afterWrite(write, () => {}, saveFailed);
  const arranging = arrangements.length > 1;
  if (!editHref && !onEditImages && !overlays.length && !arranging) return null;
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
      {arranging && (
        <ChoiceGroup
          label={t('song.arrangements')}
          choices={arrangements.map((a, i) => ({ id: a.id, title: a.name ?? `${t('song.arrangement')} ${i + 1}` }))}
          chosen={item.arrangementId ?? arrangements[0]!.id}
          divided={!!editHref || !!onEditImages}
          onChoose={(arrangementId) => failing(db.mutate('setItemArrangement', { itemId: item.id, arrangementId }))}
        />
      )}
      {!!overlays.length && (
        <ChoiceGroup
          label={t('overlays.itemOverlay')}
          choices={[{ id: '', title: t('overlays.itemNone') }, ...overlays.map((o) => ({ id: o.id, title: o.title }))]}
          chosen={item.overlayId ?? ''}
          divided={!!editHref || !!onEditImages || arranging}
          onChoose={(overlayId) => failing(db.mutate('setItemOverlay', { itemId: item.id, overlayId: overlayId || null }))}
        />
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
