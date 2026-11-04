import { useState } from 'react';
import { blankPage, resolveTheme } from '@gp/core';
import { listCustomSlides, shownPages, type LibraryCustomSlide } from '../../db/customSlides.ts';
import { orgDefaultThemeId } from '../../db/queries.ts';
import { useData, useDb } from '../../db/react.tsx';
import { t } from '../../i18n.ts';
import { newId } from '../../ids.ts';
import { AddButton } from '../../ui/AddButton.tsx';
import { useTrySave } from '../../ui/AutoSave.tsx';
import { ShapesIcon } from '../../ui/icons.tsx';
import { Library } from '../../ui/Library.tsx';
import { NameDialog } from '../../ui/NameDialog.tsx';
import { href, navigate } from '../../ui/router.ts';
import { SlideView } from '../../ui/SlideView.tsx';
import { trashTexts } from '../Images.tsx';
import { pageSlide } from './PageNavigator.tsx';

/** A slide's first page, small, in the organisation's theme. */
export function FirstPage({ slide, themeId }: { slide: LibraryCustomSlide; themeId: string | null | undefined }) {
  const shown = useData((db) => shownPages(db, slide.pages.slice(0, 1)), [slide.pages]);
  const custom = shown?.[0] ?? { page: slide.pages[0] ?? blankPage(), images: {} };
  return (
    <span className="block w-full aspect-video rounded-lg overflow-hidden">
      <SlideView slide={pageSlide(custom)} theme={resolveTheme(null, themeId)} label={false} credits={false} />
    </span>
  );
}

/**
 * Egna slides (docs/custom-slides.md): the organisation's own slides, as a grid of their first pages; a tap opens
 * one's editor, + makes a new one, named first, and opens it.
 */
export function CustomSlides() {
  const db = useDb();
  const trySave = useTrySave();
  const slides = useData(listCustomSlides, []);
  const themeId = useData(orgDefaultThemeId, []);
  const [creating, setCreating] = useState(false);
  const byName = (a: LibraryCustomSlide, b: LibraryCustomSlide) => a.name.localeCompare(b.name, 'sv', { numeric: true });

  return (
    <Library
      title={t('nav.customSlides')}
      items={slides}
      layout="grid"
      renderTile={(s) => <FirstPage slide={s} themeId={themeId} />}
      open={(s) => href({ page: 'customSlide', id: s.id })}
      sorts={[
        { key: 'changed', label: t('library.sort.changed'), compare: (a, b) => b.updatedAt - a.updatedAt || byName(a, b) },
        { key: 'newest', label: t('library.sort.newest'), compare: (a, b) => b.createdAt - a.createdAt || byName(a, b) },
        { key: 'name', label: t('library.sort.name'), compare: byName },
      ]}
      manage
      rename={{ title: t('library.renameTitle'), label: t('song.name'), maxLength: 200, run: (s, name) => db.mutate('updateCustomSlide', { id: s.id, name, at: Date.now() }) }}
      remove={{ ...trashTexts('customSlides.trashed'), run: (s) => db.mutate('trashCustomSlide', { id: s.id, at: Date.now() }) }}
      add={<AddButton label={t('customSlides.new')} onClick={() => setCreating(true)} />}
      notices={
        creating && (
          <NameDialog
            title={t('customSlides.createTitle')}
            label={t('song.name')}
            maxLength={200}
            initial=""
            onClose={() => setCreating(false)}
            submit={async (name) => {
              const id = newId();
              if (await trySave(db.mutate('createCustomSlide', { id, name, pages: [blankPage()], at: Date.now() }))) navigate({ page: 'customSlide', id });
            }}
          />
        )
      }
      loading={t('common.loading')}
      empty={{ icon: <ShapesIcon className="size-12 mb-3 text-stone-300 dark:text-stone-600" />, title: t('customSlides.empty') }}
      noMatch={t('customSlides.noMatch')}
      count={(n) => t(n === 1 ? 'customSlides.count.one' : 'customSlides.count.many', { n })}
      testId="custom-slide"
    />
  );
}
