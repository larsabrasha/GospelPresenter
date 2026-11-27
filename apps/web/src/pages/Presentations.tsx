import type { Presentation } from '@gp/core';
import { useState } from 'react';
import { useData, useDb } from '../db/react.tsx';
import { itemsOf, listPresentations, recentTemplates } from '../db/queries.ts';
import { startPage } from '../db/views.ts';
import { locale, t } from '../i18n.ts';
import { funPick, loadingText } from '../ui/playful.ts';
import { newId } from '../ids.ts';
import { AddButton } from '../ui/AddButton.tsx';
import { EmptyPicture } from '../ui/Empty.tsx';
import { AppButton } from '../ui/AppButton.tsx';
import { useTrySave } from '../ui/AutoSave.tsx';
import { ChevronRightIcon } from '../ui/icons.tsx';
import { CARD, ROW_HOVER } from '../ui/List.tsx';
import { Segmented } from '../ui/Segmented.tsx';
import { useStoredChoice } from '../ui/SortMenu.tsx';
import { PageContainer, PageHeader } from '../ui/PageContainer.tsx';
import { href, navigate } from '../ui/router.ts';
import { usePageKeys } from '../ui/shortcuts.ts';
import { useShortcutGroup, type ShortcutGroup } from '../ui/ShortcutHelp.tsx';
import { useLiveSessions, type LiveLink } from '../live/remote.ts';
import { localToday } from './dashboard.ts';
import { StartCalendar } from './StartCalendar.tsx';
import { StartList } from './StartList.tsx';
import { TemplatesButton } from './StartRows.tsx';
import { StartTable } from './StartTable.tsx';
import { nextDate } from './templates.ts';
import { TemplatePicker } from './TemplatePicker.tsx';
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
      isNew
      initial={{
        name: template?.name ?? t('presentations.defaultName'),
        date: template ? nextDate(template) : '',
        time: template?.time ?? '',
        location: template?.location ?? '',
        description: '',
        themeId: '',
      }}
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

/** The start page's keys in the help dialog (Dashboard.razor's scope). */
const KEYS: ShortcutGroup = {
  title: t('shortcuts.group.dashboard'),
  lines: [
    { keys: ['n'], text: t('shortcuts.newPresentation') },
    { keys: ['ArrowDown'], text: t('shortcuts.moveThroughList') },
    { keys: ['Enter'], text: t('shortcuts.openPresentation') },
  ],
};

type StartView = 'list' | 'calendar' | 'table';
const VIEWS: StartView[] = ['list', 'calendar', 'table'];

/** The start page, Presentationer (Components/Dashboard.razor), as Lista, Kalender or Tabell. `n` starts Skapa. */
export function Presentations({ link, ownSessionId, manageTemplates }: { link: LiveLink; ownSessionId: string; manageTemplates: boolean }) {
  const today = localToday();
  // Lista, Kalender or Tabell, this device's, as a library's view (Lars, 2026-11-27).
  const [view, setView] = useStoredChoice('presentations-view', VIEWS);
  // What has no date and what is planned, as the core groups them for every shell (docs/view-models.md).
  const page = useData((db) => startPage(db, today), [today]);
  const templates = useData(recentTemplates, []);
  const { sessions } = useLiveSessions(link);
  const [picking, setPicking] = useState(false);
  // Skapa: the details dialog, blank (null) or from a template; first the picker when there are templates.
  const [creating, setCreating] = useState<{ template: Presentation | null } | null>(null);
  const livePresentation = sessions.find((s) => s.id === ownSessionId)?.presentationId;
  // What this window presents may be past, or another month's: looked up among all.
  const ownLive = useData((db) => (livePresentation ? listPresentations(db) : Promise.resolve([])), [livePresentation])?.find((p) => p.id === livePresentation);
  const empty = page && !page.undated.length && !page.months.length && !page.past;
  const startCreating = () => (templates?.length ? setPicking(true) : setCreating({ template: null }));
  useShortcutGroup(KEYS);
  usePageKeys((e) => {
    if (e.key === 'n' && !e.ctrlKey && !e.metaKey && !e.altKey && !picking && !creating) {
      e.preventDefault();
      startCreating();
    }
  });

  return (
    <PageContainer>
      {/* + in the heading row, as every page that lists something (ui/AddButton.tsx); `n` does the same. */}
      <PageHeader title={t('nav.presentations')} large>
        {/* Mallar beside the +, for who may change them (Lars, 2026-11-27: else only Skapa's picker led there). */}
        <span className="flex items-center gap-2 max-sm:gap-1.5">
          {manageTemplates && <TemplatesButton />}
          <AddButton label={t('presentations.new')} onClick={startCreating} />
        </span>
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
      {!page && (
        <div className={CARD}>
          <div className="loading-line px-4 py-3 text-stone-400">{loadingText()}</div>
        </div>
      )}
      {empty && (
        <EmptyPicture picture={<PresentationsPicture />} title={funPick(t('presentations.emptyTitle'), [t('fun.presentationsEmpty1'), t('fun.presentationsEmpty2')])} text={t('presentations.emptyText')}>
          <AppButton onClick={startCreating}>{t('presentations.emptyNew')}</AppButton>
        </EmptyPicture>
      )}
      {page && !empty && (
        <div className="space-y-4">
          <div className="px-2">
            <Segmented
              label={t('presentations.viewAs')}
              options={[
                { key: 'list', label: t('presentations.viewList') },
                { key: 'calendar', label: t('presentations.viewCalendar') },
                { key: 'table', label: t('presentations.viewTable') },
              ]}
              value={view as StartView}
              onChange={setView}
            />
          </div>
          {view === 'list' && <StartList page={page} today={today} liveId={livePresentation} onCalendar={() => setView('calendar')} />}
          {view === 'calendar' && <StartCalendar today={today} undated={page.undated} liveId={livePresentation} />}
          {view === 'table' && <StartTable today={today} />}
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
