import { useState, type ReactNode } from 'react';
import type { Me } from '@gp/core';
import { t } from '../../i18n.ts';
import { Avatar } from '../../TopBar.tsx';
import { AppButton } from '../../ui/AppButton.tsx';
import { ROUND_BACK, ROUND_CLOSE } from '../../ui/glass.ts';
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon } from '../../ui/icons.tsx';
import { PageFloatSlot } from '../../ui/headerFloat.ts';
import { SearchField } from '../../ui/Picker.tsx';
import { PageAlone, PageBackInBar, PageBarSlot, PageFill, PageIntroProvider } from '../../ui/PageContainer.tsx';
import { adminBack, aloneInSettings, href, type Route } from '../../ui/router.ts';
import { isOpen, MINE, searchSettings, settingsGroups, type SettingsLink } from './settingsLinks.ts';

/**
 * A list row's height: 52 pt as iOS 27's inset grouped lists; in a computer's sidebar the running order's pill (36 px,
 * 44 for a finger), so the two lists match (Lars, 2026-11-02).
 */
const ROW = 'min-h-[52px] split:min-h-9 split:touch:min-h-11';

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
      // From `lg` the row is the hover's room, edge to edge with the next, and its pill (`before`) is drawn 2 px in from
      // top and bottom: the rows stand apart, and the pointer never falls between them (Lars, 2026-11-02).
      className={`relative isolate flex items-center gap-3.5 split:gap-3 pl-4 split:pl-3 split:py-0.5 split:rounded-full no-underline text-stone-900 dark:text-stone-100 hover:bg-raised split:hover:bg-transparent split:before:absolute split:before:inset-x-0 split:before:inset-y-0.5 split:before:-z-10 split:before:rounded-full split:hover:before:bg-black/5 dark:split:hover:before:bg-white/10 ${open ? 'split:before:bg-sky-500! split:text-white!' : ''}`}
    >
      <span className={`shrink-0 size-[30px] split:size-6 rounded-lg split:rounded-md flex items-center justify-center text-white ${link.colour}`}>
        <link.icon className="size-[17px] split:size-3.5" />
      </span>
      <span className={`flex-1 min-w-0 flex items-center gap-2 ${ROW} pr-3.5 text-[17px] split:text-[15px] ${first ? '' : 'max-split:border-t-[0.5px] max-split:border-separator'}`}>
        <span className="flex-1 min-w-0 flex flex-col">
          <span className="truncate">{t(link.label)}</span>
          {link.where && <span className={`text-[13px] truncate ${open ? 'split:text-white/80' : 'text-stone-500 dark:text-stone-400'}`}>{t(link.where)}</span>}
        </span>
        <ChevronRightIcon className="size-4 text-stone-400 dark:text-stone-600 split:hidden" />
      </span>
    </a>
  );
}

/**
 * The list: a search field at the top, as iOS's Settings has (Lars, 2026-11-03), then Mina inställningar as a profile
 * cell and the groups (settingsLinks.ts), the same sizes at every width. While the field holds words, what they find
 * stands in one group instead, the rows as in the list.
 */
function SettingsList({ me, host, route }: { me: Me; host: boolean; route: Route }) {
  const mine = isOpen(MINE, route);
  const [query, setQuery] = useState('');
  const groups = settingsGroups(me, host);
  const found = searchSettings(groups, query, t);
  return (
    <nav className="flex flex-col gap-[22px] split:gap-4" aria-label={t('nav.adminMenu')}>
      <SearchField compact filled value={query} onChange={setQuery} label={t('search.field')} />
      {query.trim() ? (
        found.length ? (
          <section className="flex flex-col max-split:rounded-[22px] max-split:overflow-hidden max-split:bg-surface" aria-label={t('search.field')}>
            {found.map((l, i) => (
              <Row key={l.label} link={l} route={route} first={i === 0} />
            ))}
          </section>
        ) : (
          <p className="px-4 split:px-3 text-sm text-stone-500 dark:text-stone-400">{t('search.none', { query: query.trim() })}</p>
        )
      ) : (
        <>
          <a
            href={href(MINE.route)}
            aria-current={mine ? 'page' : undefined}
            aria-label={t('nav.settings')}
            className={`flex items-center gap-3.5 split:gap-3 p-3 split:p-2 rounded-[22px] split:rounded-full no-underline ${mine ? 'bg-surface text-stone-900 dark:text-stone-100 split:bg-sky-500 split:text-white' : 'bg-surface split:bg-transparent split:hover:bg-black/5 dark:split:hover:bg-white/10 text-stone-900 dark:text-stone-100'}`}
          >
            <Avatar name={me.name} className="size-14 text-xl split:size-10 split:text-base" />
            <span className="flex-1 min-w-0 flex flex-col">
              <span className="text-xl split:text-[15px] font-semibold truncate">{me.name}</span>
              <span className={`text-[13px] truncate text-stone-500 dark:text-stone-400 ${mine ? 'split:text-white/80 dark:split:text-white/80' : ''}`}>{t('nav.settings')}</span>
            </span>
            <ChevronRightIcon className="size-4 text-stone-400 dark:text-stone-600 split:hidden" />
          </a>
          {groups.map((g) => (
            <section key={g.title ?? g.links[0]?.label} className="flex flex-col gap-1.5 split:gap-0.5" aria-label={g.title ? t(g.title) : undefined}>
              {g.title && (
                <h2 className="px-4 split:px-3 text-sm/5 font-semibold split:text-[13px]/5 text-stone-500 dark:text-stone-400">{t(g.title)}</h2>
              )}
              <div className="flex flex-col max-split:rounded-[22px] max-split:overflow-hidden max-split:bg-surface">
                {g.links.map((l, i) => (
                  <Row key={l.label} link={l} route={route} first={i === 0} />
                ))}
              </div>
            </section>
          ))}
        </>
      )}
    </nav>
  );
}

/**
 * Inställningar's frame in its dialog (docs/layout-2-0.md): on a computer as macOS's System Settings, the list at the
 * left and the page at the right; on a phone (where the dialog fills the screen) and an iPad held upright as iOS's
 * Settings, the list alone at `/admin`, and a row's page full width with a round ‹ in the dialog's bar back to it
 * (PageDialog's `back`). A page opened straight from outside (a song from a presentation) stands alone, without the
 * list or a way back: Stäng closes it.
 */
export function SettingsLayout({
  me,
  host,
  route,
  bar,
  onIntroTitle,
  children,
}: {
  me: Me;
  host: boolean;
  route: Route;
  /** The content column's bar from `lg`: the page's name (hidden while its intro card shows it), the ‹, and Stäng. */
  bar: { title: string; titleShown: boolean; back?: { href: string; label: string }; onClose: () => void };
  onIntroTitle: (inView: boolean) => void;
  children: ReactNode;
}) {
  const atList = route.page === 'admin';
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  const [float, setFloat] = useState<HTMLDivElement | null>(null);
  const link = settingsGroups(me, host)
    .flatMap((g) => g.links)
    .find((l) => l.route.page === route.page && l.intro);
  const intro = link?.intro ? { icon: link.icon, colour: link.colour, text: t(link.intro), onTitleInView: onIntroTitle } : null;
  // The content column's bar from `lg`: ‹ one step up where there is a step (the list is beside it), the name, Stäng.
  const contentBar = (
    <div data-bar className="hidden split:flex items-center gap-3 h-14 shrink-0 px-5 border-b-[0.5px] border-separator">
      {bar.back && bar.back.href !== href({ page: 'admin' }) && (
        <a href={bar.back.href} aria-label={bar.back.label} title={bar.back.label} className={`-ml-1 ${ROUND_BACK}`}>
          <ChevronLeftIcon className="size-5" />
        </a>
      )}
      {/* Keyed by the name: another page's starts as it should be, not fading from the last one's state. */}
      <span key={bar.title} data-bar-title aria-hidden="true" className={`flex-1 min-w-0 font-semibold text-[17px] truncate transition-opacity ${bar.titleShown ? '' : 'opacity-0'}`}>
        {bar.title}
      </span>
      {/* A detail page's own name and Sparad (DetailHeader) take the title's place. */}
      <div ref={setSlot} data-bar-slot className="relative flex-1 min-w-0 flex items-center pr-20 empty:hidden" />
      {/* Stäng at the top right, as every dialog has it. */}
      <AppButton variant="plain" onClick={bar.onClose} aria-label={t('common.close')} title={t('common.close')} className={`-mr-1 ${ROUND_CLOSE}`}>
        <CloseIcon className="size-4" />
      </AppButton>
    </div>
  );
  // A page opened from outside has the same bar, its name and Sparad in it (Lars, 2026-11-02), and no list beside it.
  if (aloneInSettings(route, adminBack()))
    return (
      <main className="flex-1 min-w-0 overflow-hidden flex flex-col relative bg-ground">
        {contentBar}
        <PageAlone value>
          <PageBackInBar value>
            <PageBarSlot value={slot}>
              <PageFill value>{children}</PageFill>
            </PageBarSlot>
          </PageBackInBar>
        </PageAlone>
      </main>
    );
  return (
    <div className="flex flex-1 min-h-0">
      <aside className={`split:w-80 shrink-0 overflow-y-auto bg-ground split:bg-sidebar split:border-r-[0.5px] split:border-separator px-4 pt-4 pb-12 split:py-4 ${atList ? 'max-split:flex-1' : 'max-split:hidden'}`}>
        <SettingsList me={me} host={host} route={route} />
      </aside>
      <main className={`flex-1 min-w-0 overflow-hidden flex flex-col relative bg-ground ${atList ? 'max-split:hidden' : ''}`}>
        {contentBar}
        <PageBackInBar value>
          <PageBarSlot value={slot}>
            <PageFloatSlot value={float}>
              <PageIntroProvider value={intro}>
                <PageFill value>{children}</PageFill>
              </PageIntroProvider>
            </PageFloatSlot>
          </PageBarSlot>
        </PageBackInBar>
        {/* A list page's +, floating over the list at the bottom right (PageHeader). */}
        <div ref={setFloat} className="absolute z-10 right-5 bottom-[max(1.25rem,env(safe-area-inset-bottom))] flex gap-3 empty:hidden" />
      </main>
    </div>
  );
}
