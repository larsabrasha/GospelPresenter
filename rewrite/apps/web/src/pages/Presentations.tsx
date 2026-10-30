import type { Presentation } from '@gp/core';
import { useState, type HTMLAttributes } from 'react';
import { useData, useDb } from '../db/react.tsx';
import { itemsOf, listPresentations, pinnedIds, recentTemplates } from '../db/queries.ts';
import { t } from '../i18n.ts';
import { newId } from '../ids.ts';
import { AppButton } from '../ui/AppButton.tsx';
import { useTrySave } from '../ui/AutoSave.tsx';
import { Dialog } from '../ui/Dialog.tsx';
import { CloseIcon, DocumentIcon, DocumentTextIcon, PlusIcon, TrashIcon } from '../ui/icons.tsx';
import { CARD, ListCard, ListLinkRow, ListSection } from '../ui/List.tsx';
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
  'flex items-center gap-3 w-full px-4 py-3 rounded-xl border border-neutral-200 dark:border-neutral-600 hover:border-sky-500 dark:hover:border-sky-500 hover:bg-neutral-50 dark:hover:bg-neutral-700 text-left text-inherit cursor-pointer transition-colors';

/** The first step of Skapa when there are templates: a blank presentation, or one of the last used templates (Dashboard.razor). */
function TemplatePicker({ templates, onPick, onClose }: { templates: Presentation[]; onPick: (template: Presentation | null) => void; onClose: () => void }) {
  return (
    <Dialog title={t('presentations.createTitle')} onClose={onClose}>
      <AppButton
        variant="plain"
        className="absolute top-4 right-4 size-8 flex items-center justify-center rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-700 cursor-pointer text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
        title={t('common.close')}
        aria-label={t('common.close')}
        onClick={onClose}
      >
        <CloseIcon className="size-5" />
      </AppButton>
      <AppButton variant="plain" className={PICK} onClick={() => onPick(null)}>
        <DocumentIcon className="size-5 shrink-0 text-neutral-400 dark:text-neutral-500" />
        <span className="text-sm font-medium">{t('templates.blank')}</span>
      </AppButton>
      <div className="text-xs font-medium text-neutral-400 dark:text-neutral-500 uppercase tracking-wide pt-2">{t('templates.pickerTitle')}</div>
      <div className="flex flex-col gap-2">
        {templates.map((tp) => (
          <AppButton key={tp.id} variant="plain" className={PICK} onClick={() => onPick(tp)}>
            <DocumentTextIcon className="size-5 shrink-0 text-neutral-400 dark:text-neutral-500" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{tp.name}</div>
              {templateDetails(tp) && <div className="text-xs text-neutral-400 dark:text-neutral-500">{templateDetails(tp)}</div>}
            </div>
          </AppButton>
        ))}
      </div>
    </Dialog>
  );
}

/**
 * "Visas just nu" (spec 04 §2, LIVE-A27): a card per session elsewhere in the
 * organisation that allows remote control, with "Ta kontroll". Never this
 * window's own session.
 */
function LiveNow({ link, ownSessionId }: { link: LiveLink; ownSessionId: string }) {
  const { sessions } = useLiveSessions(link);
  // By presentation name, then id, so the cards keep their places (Dashboard.razor).
  const shown = sessions
    .filter((s) => s.remote && s.id !== ownSessionId)
    .toSorted((a, b) => (a.presentationName ?? '').localeCompare(b.presentationName ?? '', 'sv', { sensitivity: 'base' }) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
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
                <div className="text-sm font-medium text-neutral-700 dark:text-neutral-200 truncate">{s.presentationName || t('remote.nowShowingUnknown')}</div>
                <div className="text-xs text-neutral-500 dark:text-neutral-400 truncate">{s.deviceName}</div>
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
  pinned,
  nav,
}: {
  p: Presentation;
  today: string;
  showDate: boolean;
  withYear: boolean;
  live: boolean;
  pinned: boolean;
  nav: HTMLAttributes<HTMLAnchorElement>;
}) {
  const date = showDate && p.eventDate;
  // "mån 4 maj · 11:00 · Stora salen" (PresentationRow.razor).
  const subtitle = [date ? dateLabel(date, today, withYear) : null, p.time, p.location].filter(Boolean).join(' · ');
  return (
    <ListLinkRow
      href={href({ page: 'presentation', id: p.id })}
      title={p.name}
      subtitle={subtitle || null}
      subtitleTitle={date ? fullDate(date, withYear) : undefined}
      nav={nav}
      end={
        <>
          {pinned && (
            <span className="shrink-0 inline-flex items-center rounded-full bg-neutral-200 dark:bg-neutral-700 px-2 py-0.5 text-xs text-neutral-600 dark:text-neutral-300">{t('media.offlineBadge')}</span>
          )}
          {live && (
            <span className="shrink-0 inline-flex items-center gap-1 bg-red-500 text-white text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded-full">
              <span className="size-1.5 rounded-full bg-white animate-pulse" />
              {t('presentations.live')}
            </span>
          )}
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

export function Presentations({ link, ownSessionId }: { link: LiveLink; ownSessionId: string }) {
  const presentations = useData(listPresentations, []);
  const pinned = useData(pinnedIds, []);
  const templates = useData(recentTemplates, []);
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
  const row = (p: Presentation, index: number, showDate: boolean, withYear: boolean) => (
    <Row key={p.id} p={p} today={today} showDate={showDate} withYear={withYear} live={p.id === livePresentation} pinned={!!pinned?.has(p.id)} nav={list.item(index)} />
  );
  const startCreating = () => (templates?.length ? setPicking(true) : setCreating({ template: null }));
  useShortcutGroup(KEYS);
  usePageKeys((e) => {
    if (e.key === 'n' && !e.ctrlKey && !e.metaKey && !e.altKey && !picking && !creating) {
      e.preventDefault();
      startCreating();
    }
  });
  const create = (
    <AppButton onClick={startCreating} className="flex items-center" title={`${t('presentations.create')} (N)`}>
      <PlusIcon className="size-4 mr-2" />
      {t('presentations.create')}
    </AppButton>
  );
  const todayCount = groups?.today.length ?? 0;
  const restStart = todayCount + (groups?.upcoming.length ?? 0);

  return (
    <PageContainer>
      <PageHeader title={t('nav.presentations')}>{!!presentations?.length && create}</PageHeader>
      <LiveNow link={link} ownSessionId={ownSessionId} />
      {picking && templates && (
        <TemplatePicker
          templates={templates}
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
          <div className="px-4 py-3 text-neutral-400">{t('common.loading')}</div>
        </div>
      )}
      {presentations && !presentations.length && (
        <div className={CARD}>
          <div className="flex flex-col items-center justify-center text-center px-6 py-12 select-none">
            <EmptyPicture />
            <h2 className="text-lg/7 font-semibold text-neutral-500 dark:text-neutral-400 mb-2">{t('presentations.emptyTitle')}</h2>
            <p className="text-sm text-neutral-400 dark:text-neutral-500 max-w-xs leading-relaxed mb-4">{t('presentations.emptyText')}</p>
            {create}
          </div>
        </div>
      )}
      {groups && (
        <div className="space-y-5" onKeyDown={list.onKeyDown}>
          {groups.today.length > 0 && <ListSection title={t('presentations.today')}>{groups.today.map((p, i) => row(p, i, false, false))}</ListSection>}
          {groups.upcoming.length > 0 && <ListSection title={t('presentations.upcoming')}>{groups.upcoming.map((p, i) => row(p, todayCount + i, true, false))}</ListSection>}
          {rest.length > 0 && (
            <div className="space-y-2">
              <ListCard label={t('nav.presentations')}>{rest.map((p, i) => row(p, restStart + i, true, true))}</ListCard>
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
      {!!presentations?.length && (
        // Whoever has just deleted the wrong thing is looking at an emptier page than expected: the way back stays in view (Dashboard.razor).
        <div className="flex justify-center pt-2">
          <AppButton variant="cancel" href={href({ page: 'trash', kind: 'Presentation' })} className="flex items-center gap-1.5">
            <TrashIcon className="size-4" />
            {t('nav.trash')}
          </AppButton>
        </div>
      )}
    </PageContainer>
  );
}

/** The empty start page's picture: a stack of slides and a plus. */
function EmptyPicture() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 200 160" className="w-48 h-auto mb-6 text-neutral-300 dark:text-neutral-600" aria-hidden="true">
      <rect x="55" y="12" width="100" height="130" rx="8" stroke="currentColor" strokeWidth="2" fill="none" opacity="0.4" />
      <rect x="35" y="22" width="100" height="130" rx="8" stroke="currentColor" strokeWidth="2" className="fill-neutral-100 dark:fill-neutral-800" />
      <line x1="55" y1="50" x2="115" y2="50" stroke="currentColor" strokeWidth="3" strokeLinecap="round" opacity="0.5" />
      <line x1="55" y1="70" x2="110" y2="70" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.3" />
      <line x1="55" y1="83" x2="100" y2="83" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.25" />
      <line x1="55" y1="96" x2="105" y2="96" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.2" />
      <circle cx="155" cy="130" r="18" stroke="currentColor" strokeWidth="2" className="fill-neutral-100 dark:fill-neutral-800" />
      <line x1="155" y1="121" x2="155" y2="139" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="146" y1="130" x2="164" y2="130" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}
