import { t } from '../i18n.ts';
import { ROUND_ADD } from '../ui/AddButton.tsx';
import { AppButton } from '../ui/AppButton.tsx';
import { Dropdown, MENU_ITEM } from '../ui/Dropdown.tsx';
import { ArrowDownTrayIcon, CalendarIcon, DesktopIcon, DocumentDuplicateIcon, EllipsisIcon, ListBulletIcon, PlusIcon, TableCellsIcon } from '../ui/icons.tsx';
import { href } from '../ui/router.ts';
import { IconSegmented } from '../ui/ViewPicker.tsx';

// The start page's heading row (docs/planning.md, "One list"; Lars, 2026-11-28): Lista and Tabell as icons (Kalender is
// a filter), ⋯ for what is done seldom, and + for Ny presentation or Ny händelse.

export type StartView = 'list' | 'table';
export const START_VIEWS: StartView[] = ['list', 'table'];

/** The two views as icons, from a tablet's width: a phone has no room for Tabell's columns, so only Lista. */
export function StartViews({ value, onChange }: { value: StartView; onChange: (v: StartView) => void }) {
  return (
    <IconSegmented
      label={t('presentations.viewAs')}
      options={[
        { key: 'list', label: t('presentations.viewList'), icon: <ListBulletIcon className="size-4" /> },
        { key: 'table', label: t('presentations.viewTable'), icon: <TableCellsIcon className="size-4" /> },
      ]}
      value={value}
      onChange={onChange}
    />
  );
}

const ROUND_MORE = 'size-8 touch:size-10 rounded-full grid place-items-center bg-stone-200/80 hover:bg-stone-300/70 dark:bg-raised dark:hover:bg-raised-2 text-sky-600 dark:text-sky-400 cursor-pointer';

/** ⋯: Importera från Excel, and for an Admin the templates of presentations and of events. */
export function StartMore({ onImport, manageTemplates }: { onImport: () => void; manageTemplates: boolean }) {
  return (
    <Dropdown menuClassName="min-w-56" button={{ className: ROUND_MORE, 'aria-label': t('start.more'), title: t('start.more') }} trigger={<EllipsisIcon className="size-4" />}>
      <AppButton variant="plain" role="menuitem" className={MENU_ITEM} onClick={onImport}>
        <ArrowDownTrayIcon className="size-4" />
        {t('calendar.import')}
      </AppButton>
      {manageTemplates && (
        <>
          <AppButton variant="plain" role="menuitem" className={MENU_ITEM} href={href({ page: 'templates' })}>
            <DocumentDuplicateIcon className="size-4" />
            {t('start.presentationTemplates')}
          </AppButton>
          <AppButton variant="plain" role="menuitem" className={MENU_ITEM} href={href({ page: 'eventTemplates' })}>
            <DocumentDuplicateIcon className="size-4" />
            {t('eventTemplates.title')}
          </AppButton>
        </>
      )}
    </Dropdown>
  );
}

/** +: Ny presentation (which makes its event when it has a date) or Ny händelse, one without a presentation. */
export function StartNew({ onPresentation, onEvent }: { onPresentation: () => void; onEvent: () => void }) {
  return (
    <Dropdown menuClassName="min-w-56" button={{ className: ROUND_ADD, 'aria-label': t('start.new'), title: t('start.new'), 'data-new': '' } as never} trigger={<PlusIcon className="size-5" strokeWidth={2.25} />}>
      <AppButton variant="plain" role="menuitem" className={MENU_ITEM} onClick={onPresentation}>
        <DesktopIcon className="size-4" />
        {t('presentations.new')}
      </AppButton>
      <AppButton variant="plain" role="menuitem" className={MENU_ITEM} onClick={onEvent}>
        <CalendarIcon className="size-4" />
        {t('calendar.new')}
      </AppButton>
    </Dropdown>
  );
}
