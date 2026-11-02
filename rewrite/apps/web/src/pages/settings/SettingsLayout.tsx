import { useState, type ReactNode } from 'react';
import type { Me } from '@gp/core';
import { t } from '../../i18n.ts';
import { Avatar } from '../../TopBar.tsx';
import { AppButton } from '../../ui/AppButton.tsx';
import { LIFTED, ROUND_BACK } from '../../ui/glass.ts';
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon } from '../../ui/icons.tsx';
import { PageFloatSlot } from '../../ui/headerFloat.ts';
import { PageAlone, PageBackInBar, PageBarSlot, PageFill, PageIntroProvider } from '../../ui/PageContainer.tsx';
import { adminBack, aloneInSettings, href, type Route } from '../../ui/router.ts';
import { isOpen, MINE, settingsGroups, type SettingsLink } from './settingsLinks.ts';

/**
 * A list row's height: 52 pt as iOS 27's inset grouped lists; in a computer's sidebar the running order's pill (36 px,
 * 44 for a finger), so the two lists match (Lars, 2026-11-02).
 */
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
      // From `lg` the row is the hover's room, edge to edge with the next, and its pill (`before`) is drawn 2 px in from
      // top and bottom: the rows stand apart, and the pointer never falls between them (Lars, 2026-11-02).
      className={`relative isolate flex items-center gap-3.5 lg:gap-3 pl-4 lg:pl-3 lg:py-0.5 lg:rounded-full no-underline text-stone-900 dark:text-stone-100 hover:bg-raised lg:hover:bg-transparent lg:before:absolute lg:before:inset-x-0 lg:before:inset-y-0.5 lg:before:-z-10 lg:before:rounded-full lg:hover:before:bg-black/5 dark:lg:hover:before:bg-white/10 ${open ? 'lg:before:bg-sky-500! lg:text-white!' : ''}`}
    >
      <span className={`shrink-0 size-[30px] lg:size-6 rounded-lg lg:rounded-md flex items-center justify-center text-white ${link.colour}`}>
        <link.icon className="size-[17px] lg:size-3.5" />
      </span>
      <span className={`flex-1 min-w-0 flex items-center gap-2 ${ROW} pr-3.5 text-[17px] lg:text-[15px] ${first ? '' : 'max-lg:border-t-[0.5px] max-lg:border-separator'}`}>
        <span className="flex-1 truncate">{t(link.label)}</span>
        <ChevronRightIcon className="size-4 text-stone-400 dark:text-stone-600 lg:hidden" />
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
        className={`flex items-center gap-3.5 lg:gap-3 p-3 lg:p-2 rounded-[22px] lg:rounded-full no-underline ${mine ? 'bg-surface text-stone-900 dark:text-stone-100 lg:bg-sky-500 lg:text-white' : 'bg-surface lg:bg-transparent lg:hover:bg-black/5 dark:lg:hover:bg-white/10 text-stone-900 dark:text-stone-100'}`}
      >
        <Avatar name={me.name} className="size-14 text-xl lg:size-10 lg:text-base" />
        <span className="flex-1 min-w-0 flex flex-col">
          <span className="text-xl lg:text-[15px] font-semibold truncate">{me.name}</span>
          <span className={`text-[13px] truncate text-stone-500 dark:text-stone-400 ${mine ? 'lg:text-white/80 dark:lg:text-white/80' : ''}`}>{t('nav.settings')}</span>
        </span>
        <ChevronRightIcon className="size-4 text-stone-400 dark:text-stone-600 lg:hidden" />
      </a>
      {settingsGroups(me, host).map((g) => (
        <section key={g.title ?? 'about'} className="flex flex-col gap-1.5 lg:gap-0.5" aria-label={g.title ? t(g.title) : undefined}>
          {g.title && (
            <h2 className="px-4 lg:px-3 text-[13px]/4 font-semibold uppercase tracking-wide lg:text-[13px]/5 lg:normal-case lg:tracking-normal text-stone-500 dark:text-stone-400">{t(g.title)}</h2>
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
    <div data-bar className="hidden lg:flex items-center gap-3 h-14 shrink-0 px-5 border-b-[0.5px] border-separator">
      {bar.back && bar.back.href !== href({ page: 'admin' }) && (
        <a href={bar.back.href} aria-label={bar.back.label} title={bar.back.label} className={`-ml-1 ${ROUND_BACK}`}>
          <ChevronLeftIcon className="size-5" />
        </a>
      )}
      <span data-bar-title aria-hidden="true" className={`flex-1 min-w-0 font-semibold text-[17px] truncate transition-opacity ${bar.titleShown ? '' : 'opacity-0'}`}>
        {bar.title}
      </span>
      {/* A detail page's own name and Sparad (DetailHeader) take the title's place. */}
      <div ref={setSlot} data-bar-slot className="relative flex-1 min-w-0 flex items-center pr-20 empty:hidden" />
      {/* Stäng at the top right, as every dialog has it. */}
      <AppButton variant="plain" onClick={bar.onClose} aria-label={t('common.close')} title={t('common.close')} className={`-mr-1 size-8 shrink-0 rounded-full flex items-center justify-center cursor-pointer text-stone-500 ${LIFTED}`}>
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
      <aside className={`lg:w-80 shrink-0 overflow-y-auto bg-ground lg:bg-sidebar lg:border-r-[0.5px] lg:border-separator px-4 pt-4 pb-12 lg:py-4 ${atList ? 'max-lg:flex-1' : 'max-lg:hidden'}`}>
        <SettingsList me={me} host={host} route={route} />
      </aside>
      <main className={`flex-1 min-w-0 overflow-hidden flex flex-col relative bg-ground ${atList ? 'max-lg:hidden' : ''}`}>
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
