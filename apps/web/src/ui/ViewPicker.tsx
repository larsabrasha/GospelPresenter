import { t } from '../i18n.ts';
import { AppButton } from './AppButton.tsx';
import { LargeTileIcon, ListBulletIcon, Squares2x2Icon } from './icons.tsx';
import { useStoredChoice } from './SortMenu.tsx';

/**
 * How pictures, videos and slideshows show (Lars, 2026-11-05): as a list, a grid, or large, one a row at a size to
 * see them by, the same three wherever they are, in their library and in Lägg till.
 */
export type View = 'list' | 'grid' | 'large';
const VIEWS: View[] = ['list', 'grid', 'large'];

/** A picker's list (Lägg till's Bild, Video, Bildspel) in each view: rows, a grid by the dialog's width, or one a row. */
export const VIEW_LIST: Record<View, string> = {
  list: 'flex flex-col gap-1 p-1',
  grid: 'grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-1 items-center p-1',
  large: 'flex flex-col gap-4 max-w-xl mx-auto w-full p-1',
};
/** An item of it: its picture at the left of its name, or over it. */
export const VIEW_ITEM: Record<View, string> = {
  list: 'relative px-2 py-1 flex items-center gap-3 min-w-0',
  grid: 'relative p-2 flex flex-col items-center min-w-0',
  large: 'relative p-1 flex flex-col items-center min-w-0',
};

/** This device's view for `key`, `first` when none is chosen. */
export function useView(key: string, first: View): [View, (view: View) => void] {
  const [view, setView] = useStoredChoice(key, [first, ...VIEWS.filter((v) => v !== first)]);
  return [view as View, setView];
}

/** The three views as a segmented control, as Photos' and Finder's, the one shown picked. */
export function ViewPicker({ value, onChange, className }: { value: View; onChange: (view: View) => void; className?: string }) {
  return (
    <span className={`flex shrink-0 rounded-full bg-stone-200/80 dark:bg-raised p-0.5 ${className ?? ''}`} role="radiogroup" aria-label={t('library.layout')}>
      {VIEWS.map((v) => (
        <AppButton
          key={v}
          variant="plain"
          role="radio"
          aria-checked={value === v}
          aria-label={t(v === 'list' ? 'library.asList' : v === 'grid' ? 'library.asGrid' : 'library.asLarge')}
          title={t(v === 'list' ? 'library.asList' : v === 'grid' ? 'library.asGrid' : 'library.asLarge')}
          className={`h-7 w-9 touch:h-9 touch:w-10 flex items-center justify-center rounded-full cursor-pointer ${value === v ? 'bg-white dark:bg-raised-2 shadow-sm text-stone-800 dark:text-stone-100' : 'text-stone-500 dark:text-stone-400'}`}
          onClick={() => onChange(v)}
        >
          {v === 'list' ? <ListBulletIcon className="size-4" /> : v === 'grid' ? <Squares2x2Icon className="size-4" /> : <LargeTileIcon className="size-4" />}
        </AppButton>
      ))}
    </span>
  );
}
