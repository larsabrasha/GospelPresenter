import { t, type TextKey } from '../../i18n.ts';
import { AppButton } from '../../ui/AppButton.tsx';
import { Dropdown } from '../../ui/Dropdown.tsx';
import { PhotoIcon } from '../../ui/icons.tsx';
import type { NewKind } from './slideModel.ts';

// What goes on a slide (docs/custom-slides.md), as Keynote's: on a computer Text, Form and Bild in the toolbar, Form a
// menu of the shapes, each drawn as it will look; on a phone all of them in +'s sheet.

const SHAPES: [NewKind, TextKey, string][] = [
  ['rect', 'slideEditor.rect', 'w-9 h-6 bg-sky-500'],
  ['roundedRect', 'slideEditor.roundedRect', 'w-9 h-6 rounded-md bg-sky-500'],
  ['ellipse', 'slideEditor.ellipse', 'size-7 rounded-full bg-sky-500'],
  ['line', 'slideEditor.line', 'w-9 h-0.5 bg-stone-500 dark:bg-stone-300'],
];

const SHAPE_BUTTON = 'h-14 rounded-lg flex items-center justify-center cursor-pointer hover:bg-raised-2';

/** The Text tool's mark, a serif T, as Keynote's. */
export function TextMark() {
  return (
    <span aria-hidden="true" className="w-5 text-center font-serif text-lg/5 font-semibold">
      T
    </span>
  );
}

/** A shape's mark: a small square with round corners, as the shapes menu's button. */
function ShapeMark() {
  return <span aria-hidden="true" className="size-4 rounded-[4px] border-2 border-current" />;
}

/** Form in a computer's toolbar: the shapes, in a menu under it. */
export function ShapeMenu({ className, onInsert }: { className: string; onInsert: (kind: NewKind) => void }) {
  return (
    <Dropdown menuClassName="min-w-64 left-0" className="relative" button={{ className, 'aria-label': t('slideEditor.addShape'), title: t('slideEditor.shapes') }} trigger={<ShapeMark />}>
      <div className="grid grid-cols-4 gap-1 p-3">
        {SHAPES.map(([kind, key, look]) => (
          <AppButton key={kind} variant="plain" role="menuitem" aria-label={t(key)} title={t(key)} className={SHAPE_BUTTON} onClick={() => onInsert(kind)}>
            <span className={look} />
          </AppButton>
        ))}
      </div>
    </Dropdown>
  );
}

/** +'s sheet on a phone: a text, a picture, and the shapes. */
export function InsertChoices({ onInsert }: { onInsert: (kind: NewKind) => void }) {
  return (
    <div className="space-y-4" data-testid="insert-choices">
      <div className="grid grid-cols-2 gap-2">
        <AppButton variant="plain" className="h-14 rounded-xl bg-surface dark:bg-raised flex items-center justify-center gap-2 cursor-pointer" onClick={() => onInsert('text')}>
          <TextMark />
          {t('slideEditor.text')}
        </AppButton>
        <AppButton variant="plain" className="h-14 rounded-xl bg-surface dark:bg-raised flex items-center justify-center gap-2 cursor-pointer" onClick={() => onInsert('image')}>
          <PhotoIcon className="size-5" />
          {t('slideEditor.image')}
        </AppButton>
      </div>
      <p className="px-1 text-xs font-semibold text-stone-500 dark:text-stone-400">{t('slideEditor.shapes')}</p>
      <div className="grid grid-cols-4 gap-1 rounded-xl bg-surface dark:bg-raised p-2">
        {SHAPES.map(([kind, key, look]) => (
          <AppButton key={kind} variant="plain" aria-label={t(key)} title={t(key)} className={SHAPE_BUTTON} onClick={() => onInsert(kind)}>
            <span className={look} />
          </AppButton>
        ))}
      </div>
    </div>
  );
}
