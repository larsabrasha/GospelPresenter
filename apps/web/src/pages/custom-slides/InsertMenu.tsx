import { t, type TextKey } from '../../i18n.ts';
import { AppButton } from '../../ui/AppButton.tsx';
import { Dropdown, MENU_ITEM } from '../../ui/Dropdown.tsx';
import { PhotoIcon, PlusIcon } from '../../ui/icons.tsx';
import type { NewKind } from './slideModel.ts';

// Keynote's + (docs/custom-slides.md): a text, a picture of Bilder, and the shapes, each drawn as it will look.

const SHAPES: [NewKind, TextKey, string][] = [
  ['rect', 'slideEditor.rect', 'w-9 h-6 bg-sky-500'],
  ['roundedRect', 'slideEditor.roundedRect', 'w-9 h-6 rounded-md bg-sky-500'],
  ['ellipse', 'slideEditor.ellipse', 'size-7 rounded-full bg-sky-500'],
  ['line', 'slideEditor.line', 'w-9 h-0.5 bg-stone-500 dark:bg-stone-300'],
];

export function InsertMenu({ className, onInsert }: { className: string; onInsert: (kind: NewKind) => void }) {
  return (
    <Dropdown menuClassName="min-w-64 right-0" className="relative" button={{ className, 'aria-label': t('slideEditor.add'), title: t('slideEditor.add') }} trigger={<PlusIcon className="size-5" />}>
      <AppButton variant="plain" role="menuitem" className={MENU_ITEM} onClick={() => onInsert('text')}>
        <span aria-hidden="true" className="w-5 text-center font-serif text-lg/5 font-semibold">T</span>
        {t('slideEditor.text')}
      </AppButton>
      <AppButton variant="plain" role="menuitem" className={MENU_ITEM} onClick={() => onInsert('image')}>
        <PhotoIcon className="size-5" />
        {t('slideEditor.image')}
      </AppButton>
      <p className="px-4 pt-3 pb-1 text-xs font-semibold text-stone-500 dark:text-stone-400">{t('slideEditor.shapes')}</p>
      <div className="grid grid-cols-4 gap-1 px-3 pb-3">
        {SHAPES.map(([kind, key, look]) => (
          <AppButton key={kind} variant="plain" role="menuitem" aria-label={t(key)} title={t(key)} className="h-14 rounded-lg flex items-center justify-center cursor-pointer hover:bg-raised-2" onClick={() => onInsert(kind)}>
            <span className={look} />
          </AppButton>
        ))}
      </div>
    </Dropdown>
  );
}
