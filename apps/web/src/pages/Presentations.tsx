import type { Presentation } from '@gp/core';
import { useState, type HTMLAttributes } from 'react';
import { useData, useDb } from '../db/react.tsx';
import { itemCounts, itemsOf, listPresentations, recentTemplates } from '../db/queries.ts';
import { locale, t } from '../i18n.ts';
import { newId } from '../ids.ts';
import { AddButton } from '../ui/AddButton.tsx';
import { EmptyPicture } from '../ui/Empty.tsx';
import { AppButton } from '../ui/AppButton.tsx';
import { ROUND_CLOSE } from '../ui/glass.ts';
import { useTrySave } from '../ui/AutoSave.tsx';
import { Dialog } from '../ui/Dialog.tsx';
import { ChevronRightIcon, CloseIcon, DocumentIcon, DocumentTextIcon } from '../ui/icons.tsx';
import { CARD, ListLinkRow, ListSection, ROW_HOVER } from '../ui/List.tsx';
import { PageContainer, PageHeader } from '../ui/PageContainer.tsx';
import { href, navigate } from '../ui/router.ts';
import { useRovingList } from '../ui/listNav.ts';
import { usePageKeys } from '../ui/shortcuts.ts';
import { useShortcutGroup, type ShortcutGroup } from '../ui/ShortcutHelp.tsx';
import { useLiveSessions, type LiveLink } from '../live/remote.ts';
import { dateLabel, fullDate, groupPresentations, localToday } from './dashboard.ts';
import { nextDate, templateDetails } from './templates.ts';
import { detailsArgs, PresentationDetailsDialog } from './presentation-editor/PresentationDetailsDialog.tsx';

/**
 * "Skapa presentation": the details dialog, prefilled (spec 03, PRES-A2). From a
 * template, its name, the next date of its weekday, its time and its place (PRES-A3).
 */
function CreatePresentationDialog({ template, onClose }: { template: Presentation | null; onClose: () => void }) {
  const db = useDb();
  const trySave = useTrySave();
  return (
    <PresentationDetailsDialog
      title={t('presentations.createTitle')}
      initial={{
        name: template?.name ?? t('presentations.defaultName'),
        date: template ? nextDate(template) : '',
        time: template?.time ?? '',
        location: template?.location ?? '',
        description: '',
        themeId: '',
      }}
      saveText={t('common.create')}
      savingText={t('common.creating')}
      onSave={async (d) => {
        const id = newId();
        const fields = detailsArgs(d);
        // From a template: its items as they are now, each copy with an id of its own.
        const items = template ? (await itemsOf(db, template.id)).map((item) => ({ from: item.id, id: newId() })) : [];
        const write = template
          ? db.mutate('createFromTemplate', { id, templateId: template.id, ...fields, items, at: Date.now() })
          : db.mutate('createPresentation', { id, ...fields });
        if (await trySave(write)) navigate({ page: 'presentation', id });
      }}
      onClose={onClose}
    />
  );
}

const PICK =
  'flex items-center gap-3 w-full px-4 py-3 rounded-xl border border-stone-200 dark:border-stone-600 hover:border-sky-500 dark:hover:border-sky-500 hover:bg-stone-50 dark:hover:bg-raised text-left text-inherit cursor-pointer transition-colors';

/**
 * The first step of Skapa when there are templates: a blank presentation, or one of the last used templates
 * (Dashboard.razor). Who may change them has "Hantera mallar" beside the caption, to Mallar (Lars, 2026-11-02); the
 * first template is made with Spara som mall.
 */
function TemplatePicker({ templates, manage, onPick, onClose }: { templates: Presentation[]; manage: boolean; onPick: (template: Presentation | null) => void; onClose: () => void }) {
  return (
    <Dialog title={t('presentations.createTitle')} onClose={onClose}>
      <AppButton
        variant="plain"
        className={`absolute top-4 right-4 ${ROUND_CLOSE}`}
        title={t('common.close')}
        aria-label={t('common.close')}
        onClick={onClose}
      >
        <CloseIcon className="size-5" />
      </AppButton>
      <AppButton variant="plain" className={PICK} onClick={() => onPick(null)}>
        <DocumentIcon className="size-5 shrink-0 text-stone-400 dark:text-stone-500" />
        <span className="text-sm font-medium">{t('templates.blank')}</span>
      </AppButton>
      <div className="flex items-baseline justify-between gap-2 pt-2">
        <span className="text-sm font-semibold text-stone-500 dark:text-stone-400">{t('templates.pickerTitle')}</span>
        {manage && (
          <a href={href({ page: 'templates' })} onClick={onClose} className="text-sm text-sky-600 dark:text-sky-400 no-underline hover:underline">
            {t('templates.manage')}
          </a>
        )}
      </div>
      <div className="flex flex-col gap-2">
        {templates.map((tp) => (
          <AppButton key={tp.id} variant="plain" className={PICK} onClick={() => onPick(tp)}>
            <DocumentTextIcon className="size-5 shrink-0 text-stone-400 dark:text-stone-500" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{tp.name}</div>
              {templateDetails(tp) && <div className="text-xs text-stone-400 dark:text-stone-500">{templateDetails(tp)}</div>}
            </div>
          </AppButton>
        ))}
      </div>
    </Dialog>
  );
}

/**
 * What this window presents, at the top of the start page (docs/layout-2-0.md), as Music's Now Playing (Lars,
 * 2026-11-03): a card as the list's, red only in its slowly pulsing dot and the line "Visas just nu", and the whole
 * card opens it, with a › at its end rather than a button of its own.
 */
function OwnLive({ p }: { p: Presentation }) {
  return (
    <a
      href={href({ page: 'presentation', id: p.id })}
      aria-label={`${t('remote.nowShowing')}: ${p.name}`}
      className={`${CARD} flex items-center gap-3.5 px-5 py-3 no-underline text-inherit ${ROW_HOVER}`}
    >
      <span className="flex-1 min-w-0 flex flex-col gap-0.5">
        <span className="flex items-center gap-1.5 text-[13px] font-semibold text-red-500">
          <span className="size-2 rounded-full bg-red-500 animate-pulse" />
          {t('remote.nowShowing')}
        </span>
        <span className="text-[17px] lg:text-[15px] font-semibold truncate">{p.name}</span>
        <span className="text-[13px] text-stone-500 dark:text-stone-400 truncate empty:hidden">{[p.time, p.location].filter(Boolean).join(' · ')}</span>
      </span>
      <ChevronRightIcon className="size-4 shrink-0 text-stone-400 dark:text-stone-600" />
    </a>
  );
}

/**
 * "Visas just nu" (spec 04 §2, LIVE-A27): a card per session elsewhere in the
 * organisation that allows remote control, with "Ta kontroll". Never this
 * window's own session, which OwnLive shows.
 */
function LiveNow({ link, ownSessionId }: { link: LiveLink; ownSessionId: string }) {
  const { sessions } = useLiveSessions(link);
  // By presentation name, then id, so the cards keep their places (Dashboard.razor).
  const shown = sessions
    .filter((s) => s.remote && s.id !== ownSessionId)
    .toSorted((a, b) => (a.presentationName ?? '').localeCompare(b.presentationName ?? '', locale(), { sensitivity: 'base' }) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (!shown.length) return null;
  return (
    <ul className="space-y-5" aria-label={t('remote.nowShowing')}>
      {shown.map((s) => (
        <li key={s.id} className="bg-emerald-50 dark:bg-emerald-900/20 rounded-xl border border-emerald-200 dark:border-emerald-800 overflow-hidden">
          <div className="px-4 py-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <span className="inline-block size-2 rounded-full bg-emerald-500 shrink-0 animate-pulse" />
              <div className="min-w-0">
                <div className="text-xs font-semibold uppercase tracking-widest text-emerald-600 dark:text-emerald-400">{t('remote.nowShowing')}</div>
                <div className="text-sm font-medium text-stone-700 dark:text-stone-200 truncate">{s.presentationName || t('remote.nowShowingUnknown')}</div>
                <div className="text-xs text-stone-500 dark:text-stone-400 truncate">{s.deviceName}</div>
              </div>
            </div>
            {s.presentationId && (
              <a
                className="shrink-0 px-3 py-1.5 rounded-lg bg-emerald-500 text-white text-xs font-medium hover:bg-emerald-600 no-underline"
                href={href({ page: 'presentation', id: s.presentationId, remote: true, session: s.id })}
              >
                {t('remote.takeControl')}
              </a>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

function Row({
  p,
  today,
  showDate,
  withYear,
  live,
  items,
  nav,
}: {
  p: Presentation;
  today: string;
  showDate: boolean;
  withYear: boolean;
  live: boolean;
  items: number;
  nav: HTMLAttributes<HTMLAnchorElement>;
}) {
  const date = showDate && p.eventDate;
  const when = [date ? dateLabel(date, today, withYear) : null, p.time].filter(Boolean).join(' · ');
  const count = items === 1 ? t('presentations.item') : t('presentations.items', { n: items });
  // Two lines at every width, as a list in Mail or Notes (Lars, 2026-11-02: no columns): the name, and under it
  // "mån 4 maj · 11:00 · Stora salen"; the number of items at the right.
  const subtitle = [when, p.location].filter(Boolean).join(' · ');
  return (
    <ListLinkRow
      href={href({ page: 'presentation', id: p.id })}
      title={p.name}
      subtitle={subtitle || undefined}
      subtitleTitle={date ? fullDate(date, withYear) : undefined}
      nav={nav}
      end={
        <>
          {/* A small red dot, as Music marks what plays in a list: the card "Visas just nu" above says it (Lars, 2026-11-03). */}
          {live && <span role="img" aria-label={t('presentations.live')} title={t('presentations.live')} className="shrink-0 size-2 rounded-full bg-red-500" />}
          <span className="shrink-0 text-[13px] text-stone-500 dark:text-stone-400">{count}</span>
        </>
      }
    />
  );
}

const PAGE_SIZE = 20;

/** The start page, Presentationer (Components/Dashboard.razor). `n` starts Skapa. */

/** The start page's keys in the help dialog (Dashboard.razor's scope). */
const KEYS: ShortcutGroup = {
  title: t('shortcuts.group.dashboard'),
  lines: [
    { keys: ['n'], text: t('shortcuts.newPresentation') },
    { keys: ['ArrowDown'], text: t('shortcuts.moveThroughList') },
    { keys: ['Enter'], text: t('shortcuts.openPresentation') },
  ],
};

export function Presentations({ link, ownSessionId, manageTemplates }: { link: LiveLink; ownSessionId: string; manageTemplates: boolean }) {
  const presentations = useData(listPresentations, []);
  const templates = useData(recentTemplates, []);
  const counts = useData(itemCounts, []);
  const { sessions } = useLiveSessions(link);
  const [picking, setPicking] = useState(false);
  // Skapa: the details dialog, blank (null) or from a template; first the picker when there are templates.
  const [creating, setCreating] = useState<{ template: Presentation | null } | null>(null);
  // The rest shows 20 at a time, with "Visa fler" (Dashboard.razor's PageSize).
  const [restShown, setRestShown] = useState(PAGE_SIZE);
  const today = localToday();
  const groups = presentations && groupPresentations(presentations, today);
  const rest = groups?.rest.slice(0, restShown) ?? [];
  // ↑ ↓ Home End run through Idag, Kommande and the rest as one list, Tab stopping once.
  const navCount = (groups?.today.length ?? 0) + (groups?.upcoming.length ?? 0) + rest.length;
  const list = useRovingList(navCount);
  const livePresentation = sessions.find((s) => s.id === ownSessionId)?.presentationId;
  const ownLive = presentations?.find((p) => p.id === livePresentation);
  const row = (p: Presentation, index: number, showDate: boolean, withYear: boolean) => (
    <Row key={p.id} p={p} today={today} showDate={showDate} withYear={withYear} live={p.id === livePresentation} items={counts?.get(p.id) ?? 0} nav={list.item(index)} />
  );
  const startCreating = () => (templates?.length ? setPicking(true) : setCreating({ template: null }));
  useShortcutGroup(KEYS);
  usePageKeys((e) => {
    if (e.key === 'n' && !e.ctrlKey && !e.metaKey && !e.altKey && !picking && !creating) {
      e.preventDefault();
      startCreating();
    }
  });
  const todayCount = groups?.today.length ?? 0;
  const restStart = todayCount + (groups?.upcoming.length ?? 0);

  return (
    <PageContainer>
      {/* + in the heading row, as every page that lists something (ui/AddButton.tsx); `n` does the same. */}
      <PageHeader title={t('nav.presentations')} large>
        <AddButton label={t('presentations.new')} onClick={startCreating} />
      </PageHeader>
      {ownLive && <OwnLive p={ownLive} />}
      <LiveNow link={link} ownSessionId={ownSessionId} />
      {picking && templates && (
        <TemplatePicker
          templates={templates}
          manage={manageTemplates}
          onClose={() => setPicking(false)}
          onPick={(template) => {
            setPicking(false);
            setCreating({ template });
          }}
        />
      )}
      {creating && <CreatePresentationDialog template={creating.template} onClose={() => setCreating(null)} />}
      {!presentations && (
        <div className={CARD}>
          <div className="loading-line px-4 py-3 text-stone-400">{t('common.loading')}</div>
        </div>
      )}
      {presentations && !presentations.length && (
        <EmptyPicture picture={<PresentationsPicture />} title={t('presentations.emptyTitle')} text={t('presentations.emptyText')}>
          <AppButton onClick={startCreating}>{t('presentations.emptyNew')}</AppButton>
        </EmptyPicture>
      )}
      {groups && (
        <div className="space-y-5" onKeyDown={list.onKeyDown}>
          {groups.today.length > 0 && <ListSection title={t('presentations.today')}>{groups.today.map((p, i) => row(p, i, false, false))}</ListSection>}
          {groups.upcoming.length > 0 && <ListSection title={t('presentations.upcoming')}>{groups.upcoming.map((p, i) => row(p, todayCount + i, true, false))}</ListSection>}
          {rest.length > 0 && (
            <div className="space-y-2">
              <ListSection title={t('presentations.recent')}>{rest.map((p, i) => row(p, restStart + i, true, true))}</ListSection>
              {rest.length < groups.rest.length && (
                <div className="flex justify-center pt-2">
                  <AppButton variant="cancel" onClick={() => setRestShown((n) => n + PAGE_SIZE)}>
                    {t('common.showMore')}
                  </AppButton>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </PageContainer>
  );
}

/** The empty start page's picture: a stack of slides and a plus. */
function PresentationsPicture() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 200 160" className="w-48 h-auto mb-6 text-stone-300 dark:text-stone-600" aria-hidden="true">
      <rect x="55" y="12" width="100" height="130" rx="8" stroke="currentColor" strokeWidth="2" fill="none" opacity="0.4" />
      <rect x="35" y="22" width="100" height="130" rx="8" stroke="currentColor" strokeWidth="2" className="fill-stone-100 dark:fill-stone-800" />
      <line x1="55" y1="50" x2="115" y2="50" stroke="currentColor" strokeWidth="3" strokeLinecap="round" opacity="0.5" />
      <line x1="55" y1="70" x2="110" y2="70" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.3" />
      <line x1="55" y1="83" x2="100" y2="83" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.25" />
      <line x1="55" y1="96" x2="105" y2="96" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.2" />
      <circle cx="155" cy="130" r="18" stroke="currentColor" strokeWidth="2" className="fill-stone-100 dark:fill-stone-800" />
      <line x1="155" y1="121" x2="155" y2="139" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="146" y1="130" x2="164" y2="130" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}
