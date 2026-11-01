import type { ReactNode } from 'react';
import type { Me } from '@gp/core';
import { t } from '../../i18n.ts';
import { Avatar } from '../../TopBar.tsx';
import { ChevronLeftIcon, ChevronRightIcon } from '../../ui/icons.tsx';
import { PageAlone, PageFill } from '../../ui/PageContainer.tsx';
import { adminBack, aloneInSettings, href, type Route } from '../../ui/router.ts';
import { isOpen, MINE, settingsGroups, type SettingsLink } from './settingsLinks.ts';

/** A list row's height: 52 pt as iOS 27's inset grouped lists; in a computer's sidebar as macOS's, 44 pt for a finger. */
const ROW = 'min-h-[52px] lg:min-h-9 lg:touch:min-h-11';

/**
 * A row of the list: a coloured icon, the name, and a chevron on a phone, in its group's card as iOS 27's inset grouped
 * lists. On a computer, as iPadOS's sidebar (Filer): no card, the rows straight on the sidebar, the open one a pill in
 * the app's blue.
 */
function Row({ link, route, first }: { link: SettingsLink; route: Route; first: boolean }) {
  const open = isOpen(link, route);
  return (
    <a
      href={href(link.route)}
      aria-current={open && route.page !== 'admin' ? 'page' : undefined}
      className={`flex items-center gap-3.5 lg:gap-3 pl-4 lg:pl-3 lg:rounded-full no-underline text-neutral-900 dark:text-neutral-100 hover:bg-raised lg:hover:bg-black/5 dark:lg:hover:bg-white/10 ${open ? 'lg:bg-sky-500! lg:text-white!' : ''}`}
    >
      <span className={`shrink-0 size-[30px] lg:size-6 rounded-lg lg:rounded-md flex items-center justify-center text-white ${link.colour}`}>
        <link.icon className="size-[17px] lg:size-3.5" />
      </span>
      <span className={`flex-1 min-w-0 flex items-center gap-2 ${ROW} pr-3.5 text-[17px] lg:text-[15px] ${first ? '' : 'max-lg:border-t-[0.5px] max-lg:border-separator'}`}>
        <span className="flex-1 truncate">{t(link.label)}</span>
        <ChevronRightIcon className="size-4 text-neutral-400 dark:text-neutral-600 lg:hidden" />
      </span>
    </a>
  );
}

/** The list: Mina inställningar as a profile cell at the top, then the groups (settingsLinks.ts), the same sizes at every width. */
function SettingsList({ me, host, route }: { me: Me; host: boolean; route: Route }) {
  const mine = isOpen(MINE, route);
  return (
    <nav className="flex flex-col gap-[22px] lg:gap-4" aria-label={t('nav.adminMenu')}>
      <a
        href={href(MINE.route)}
        aria-current={mine ? 'page' : undefined}
        aria-label={t('nav.settings')}
        className={`flex items-center gap-3.5 lg:gap-3 p-3 lg:p-2 rounded-[22px] lg:rounded-full no-underline ${mine ? 'bg-surface text-neutral-900 dark:text-neutral-100 lg:bg-sky-500 lg:text-white' : 'bg-surface lg:bg-transparent lg:hover:bg-black/5 dark:lg:hover:bg-white/10 text-neutral-900 dark:text-neutral-100'}`}
      >
        <Avatar name={me.name} className="size-14 text-xl lg:size-10 lg:text-base" />
        <span className="flex-1 min-w-0 flex flex-col">
          <span className="text-xl lg:text-[15px] font-semibold truncate">{me.name}</span>
          <span className={`text-[13px] truncate text-neutral-500 dark:text-neutral-400 ${mine ? 'lg:text-white/80 dark:lg:text-white/80' : ''}`}>{t('nav.settings')}</span>
        </span>
        <ChevronRightIcon className="size-4 text-neutral-400 dark:text-neutral-600 lg:hidden" />
      </a>
      {settingsGroups(me, host).map((g) => (
        <section key={g.title ?? 'about'} className="flex flex-col gap-1.5 lg:gap-0.5" aria-label={g.title ? t(g.title) : undefined}>
          {g.title && (
            <h2 className="px-4 lg:px-3 text-[13px]/4 font-semibold uppercase tracking-wide lg:text-[13px]/5 lg:normal-case lg:tracking-normal text-neutral-500 dark:text-neutral-400">{t(g.title)}</h2>
          )}
          <div className="flex flex-col max-lg:rounded-[22px] max-lg:overflow-hidden max-lg:bg-surface">
            {g.links.map((l, i) => (
              <Row key={l.label} link={l} route={route} first={i === 0} />
            ))}
          </div>
        </section>
      ))}
    </nav>
  );
}

/**
 * Inställningar's frame in its dialog (docs/layout-2-0.md): on a computer as macOS's System Settings, the list at the
 * left and the page at the right; on a phone (where the dialog fills the screen) and an iPad held upright as iOS's
 * Settings, the list alone at `/admin`, and a row's page full width with "‹ Inställningar" back to it. A page opened
 * straight from outside (a song from a presentation) stands alone, without the list or a way back: Stäng closes it.
 */
export function SettingsLayout({ me, host, route, children }: { me: Me; host: boolean; route: Route; children: ReactNode }) {
  const atList = route.page === 'admin';
  if (aloneInSettings(route, adminBack()))
    return (
      <main className="flex-1 min-w-0 overflow-hidden flex flex-col relative bg-ground">
        <PageAlone value>
          <PageFill value>{children}</PageFill>
        </PageAlone>
      </main>
    );
  return (
    <div className="flex flex-1 min-h-0">
      <aside className={`lg:w-80 shrink-0 overflow-y-auto bg-ground lg:bg-raised dark:lg:bg-surface lg:border-r-[0.5px] lg:border-separator px-4 pt-4 pb-12 lg:py-4 ${atList ? 'max-lg:flex-1' : 'max-lg:hidden'}`}>
        <SettingsList me={me} host={host} route={route} />
      </aside>
      <main className={`flex-1 min-w-0 overflow-hidden flex flex-col relative bg-ground ${atList ? 'max-lg:hidden' : ''}`}>
        <a href={href({ page: 'admin' })} className="lg:hidden self-start flex items-center gap-0.5 mx-3 mt-3 -mb-2 text-sky-500 text-[15px] font-medium no-underline">
          <ChevronLeftIcon className="size-5" />
          {t('nav.admin')}
        </a>
        <PageFill value>{children}</PageFill>
      </main>
    </div>
  );
}
