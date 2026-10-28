import type { Presentation } from '@gp/core';
import { useState } from 'react';
import { useData, useDb } from '../db/react.tsx';
import { listPresentations, pinnedIds } from '../db/queries.ts';
import { t } from '../i18n.ts';
import { newId } from '../ids.ts';
import { AppButton } from '../ui/AppButton.tsx';
import { Dialog, DialogButtons } from '../ui/Dialog.tsx';
import { FloatingInput } from '../ui/Floating.tsx';
import { PlusIcon, TrashIcon } from '../ui/icons.tsx';
import { CARD, ListCard, ListLinkRow, ListSection } from '../ui/List.tsx';
import { PageContainer, PageHeader } from '../ui/PageContainer.tsx';
import { href, navigate } from '../ui/router.ts';
import { useLiveSessions, type LiveLink } from '../live/remote.ts';
import { dateLabel, fullDate, groupPresentations, localToday } from './dashboard.ts';

/** "Skapa presentation": name (prefilled) and date; Enter saves (spec 03, PRES-A2). */
function CreatePresentationDialog({ onClose }: { onClose: () => void }) {
  const db = useDb();
  const [name, setName] = useState(t('presentations.defaultName'));
  const [date, setDate] = useState('');
  const [saving, setSaving] = useState(false);
  return (
    <Dialog title={t('presentations.createTitle')} onClose={onClose} showClose>
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim() || saving) return;
          setSaving(true);
          const id = newId();
          await db.mutate('createPresentation', { id, name, eventDate: date || null });
          navigate({ page: 'presentation', id });
        }}
      >
        <FloatingInput label={t('presentation.name')} autoFocus maxLength={200} value={name} onFocus={(e) => e.currentTarget.select()} onChange={(e) => setName(e.target.value)} />
        <FloatingInput label={t('presentation.date')} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <DialogButtons>
          <AppButton variant="cancel" onClick={onClose}>
            {t('common.cancel')}
          </AppButton>
          <AppButton type="submit" disabled={!name.trim() || saving}>
            {t('common.create')}
          </AppButton>
        </DialogButtons>
      </form>
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
  const shown = sessions.filter((s) => s.remote && s.id !== ownSessionId);
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
                <div className="text-sm font-medium text-neutral-700 dark:text-neutral-200 truncate">{s.presentationName}</div>
                <div className="text-xs text-neutral-500 dark:text-neutral-400 truncate">{s.deviceName}</div>
              </div>
            </div>
            <a
              className="shrink-0 px-3 py-1.5 rounded-lg bg-emerald-500 text-white text-xs font-medium hover:bg-emerald-600 no-underline"
              href={href({ page: 'live', id: s.presentationId, remote: true, session: s.id })}
            >
              {t('remote.takeControl')}
            </a>
          </div>
        </li>
      ))}
    </ul>
  );
}

function Row({ p, today, showDate, withYear, live, pinned }: { p: Presentation; today: string; showDate: boolean; withYear: boolean; live: boolean; pinned: boolean }) {
  const date = showDate && p.eventDate;
  return (
    <ListLinkRow
      href={href(live ? { page: 'live', id: p.id } : { page: 'presentation', id: p.id })}
      title={p.name}
      subtitle={date ? dateLabel(date, today, withYear) : null}
      subtitleTitle={date ? fullDate(date) : undefined}
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

/** The start page, Presentationer (Components/Dashboard.razor). */
export function Presentations({ link, ownSessionId }: { link: LiveLink; ownSessionId: string }) {
  const presentations = useData(listPresentations, []);
  const pinned = useData(pinnedIds, []);
  const { sessions } = useLiveSessions(link);
  const [creating, setCreating] = useState(false);
  const today = localToday();
  const groups = presentations && groupPresentations(presentations, today);
  const livePresentation = sessions.find((s) => s.id === ownSessionId)?.presentationId;
  const row = (p: Presentation, showDate: boolean, withYear: boolean) => (
    <Row key={p.id} p={p} today={today} showDate={showDate} withYear={withYear} live={p.id === livePresentation} pinned={!!pinned?.has(p.id)} />
  );
  const create = (
    <AppButton onClick={() => setCreating(true)} className="flex items-center">
      <PlusIcon className="size-4 mr-2" />
      {t('presentations.create')}
    </AppButton>
  );

  return (
    <PageContainer>
      <PageHeader title={t('nav.presentations')}>{!!presentations?.length && create}</PageHeader>
      <LiveNow link={link} ownSessionId={ownSessionId} />
      {creating && <CreatePresentationDialog onClose={() => setCreating(false)} />}
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
        <>
          {groups.today.length > 0 && <ListSection title={t('presentations.today')}>{groups.today.map((p) => row(p, false, false))}</ListSection>}
          {groups.upcoming.length > 0 && <ListSection title={t('presentations.upcoming')}>{groups.upcoming.map((p) => row(p, true, false))}</ListSection>}
          {groups.rest.length > 0 && <ListCard label={t('nav.presentations')}>{groups.rest.map((p) => row(p, true, true))}</ListCard>}
        </>
      )}
      {presentations && (
        // Always here, also on an empty page (the current app hides it there): whoever has just deleted the last one needs the way back in view.
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
