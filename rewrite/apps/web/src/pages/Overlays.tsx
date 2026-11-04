import { useMemo } from 'react';
import { blankPage, type Overlay, type Theme } from '@gp/core';
import { defaultTheme, listOverlays } from '../db/queries.ts';
import { useData, useDb, useShownOverlay } from '../db/react.tsx';
import { t } from '../i18n.ts';
import { newId } from '../ids.ts';
import { AddButton } from '../ui/AddButton.tsx';
import { AppButton } from '../ui/AppButton.tsx';
import { useTrySave } from '../ui/AutoSave.tsx';
import { SquaresOverlapIcon } from '../ui/icons.tsx';
import { Library } from '../ui/Library.tsx';
import { freshName, markCreated } from '../ui/justCreated.ts';
import { href, navigate } from '../ui/router.ts';
import { SlideView } from '../ui/SlideView.tsx';
import { pageSlide } from './custom-slides/PageNavigator.tsx';

type OverlayEntry = Overlay & { name: string };

/** An overlay's page above an empty slide of the organisation's theme, as it shows above one. */
function OverlayTile({ overlay, theme }: { overlay: OverlayEntry; theme: Theme | undefined }) {
  const shown = useShownOverlay(overlay.id);
  return (
    <span className="block w-full aspect-video rounded-lg overflow-hidden">
      <SlideView slide={pageSlide(blankPage())} overlay={shown} theme={theme} label={false} credits={false} />
    </span>
  );
}

/**
 * Överlägg (docs/custom-slides.md, spec 03 §4 `/admin/overlays`): a page shown above the live slide, e.g. a Swish
 * number at the collection, made in the custom slides' editor. A grid of them; a tap opens one's editor, + makes a
 * new one at once and opens it, its name picked to type over. Deleting is permanent and asks first (PRES-R29). Everyone may make and change
 * them (ManageOverlays is every role's).
 */
export function Overlays() {
  const db = useDb();
  const trySave = useTrySave();
  const rows = useData(listOverlays, []);
  const overlays = useMemo(() => rows?.map((o) => ({ ...o, name: o.title })), [rows]);
  const theme = useData(defaultTheme, []);
  /** + makes "Nytt överlägg" at once and opens it with its name picked (Lars, 2026-11-04). */
  const create = async () => {
    const id = newId();
    const title = freshName(t('overlays.new'), (overlays ?? []).map((o) => o.name));
    if (await trySave(db.mutate('createOverlay', { id, title, at: Date.now() }))) {
      markCreated(id);
      navigate({ page: 'overlay', id });
    }
  };
  const byName = (a: OverlayEntry, b: OverlayEntry) => a.name.localeCompare(b.name, 'sv', { numeric: true });

  return (
    <Library
      title={t('overlays.title')}
      items={overlays}
      layout="grid"
      renderTile={(o) => <OverlayTile overlay={o} theme={theme} />}
      open={(o) => href({ page: 'overlay', id: o.id })}
      sorts={[
        { key: 'changed', label: t('library.sort.changed'), compare: (a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0) || byName(a, b) },
        { key: 'newest', label: t('library.sort.newest'), compare: (a, b) => b.sort - a.sort },
        { key: 'name', label: t('library.sort.name'), compare: byName },
      ]}
      manage
      rename={{ title: t('library.renameTitle'), label: t('overlays.createName'), maxLength: 200, run: (o, title) => db.mutate('updateOverlay', { id: o.id, title, at: Date.now() }) }}
      remove={{
        ask: (items) => (items.length === 1 ? { text: t('overlays.removeConfirm', { title: items[0]!.name }), bold: items[0]!.name } : { text: t('overlays.removeMany', { n: items.length }) }),
        run: (o) => db.mutate('deleteOverlay', { id: o.id }),
        done: (items) => (items.length === 1 ? t('overlays.removed', { name: items[0]!.name }) : t('overlays.removedMany', { n: items.length })),
      }}
      add={<AddButton label={t('common.create')} onClick={() => void create()} />}
      loading={t('common.loading')}
      empty={{ icon: <SquaresOverlapIcon className="size-12 mb-3 text-stone-300 dark:text-stone-600" />, title: t('overlays.empty'),
        action: <AppButton onClick={() => void create()}>{t('overlays.new')}</AppButton>,
      }}
      noMatch={t('overlays.noMatch')}
      count={(n) => t(n === 1 ? 'overlays.count.one' : 'overlays.count.many', { n })}
      testId="overlay"
    />
  );
}
