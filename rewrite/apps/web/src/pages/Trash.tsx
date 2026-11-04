import { can, daysRemaining, TRASH_RETENTION_MS, type Role } from '@gp/core';
import { useEffect, useRef, useState } from 'react';
import { useData, useDb } from '../db/react.tsx';
import { listTrash, type TrashEntry } from '../db/queries.ts';
import { t } from '../i18n.ts';
import { AppButton } from '../ui/AppButton.tsx';
import { useConfirm } from '../ui/Dialog.tsx';
import {
  DocumentTextIcon,
  MapIcon,
  MusicalNoteOutlineIcon,
  PhotoOutlineIcon,
  ShapesIcon,
  SpeakerOutlineIcon,
  TrashIcon,
  VideoOutlineIcon,
} from '../ui/icons.tsx';
import { CARD } from '../ui/List.tsx';
import { EmptySmall } from '../ui/Empty.tsx';
import { DANGER_ROW, Group } from '../ui/Group.tsx';
import { PageContainer, PageHeader } from '../ui/PageContainer.tsx';
import { SearchField } from '../ui/Picker.tsx';
import { PillTab, PillTabs } from '../ui/PillTabs.tsx';
import { TRASH_KINDS, type TrashKind } from '../ui/router.ts';
import { useToast } from '../ui/Toast.tsx';
import { templateDetails } from './templates.ts';

const manages: Record<TrashKind, Parameters<typeof can>[1]> = {
  Presentation: 'ManagePresentations',
  Template: 'ManageTemplates',
  Song: 'ManageSongs',
  Image: 'ManageImages',
  Audio: 'ManageAudios',
  Video: 'ManageVideos',
  Slide: 'ManagePresentations',
};
const restoreMutator = { Presentation: 'restorePresentation', Template: 'restoreTemplate', Song: 'restoreSong', Image: 'restoreImage', Audio: 'restoreAudio', Video: 'restoreVideo', Slide: 'restoreCustomSlide' } as const;
const purgeMutator = { Presentation: 'purgePresentation', Template: 'purgeTemplate', Song: 'purgeSong', Image: 'purgeImage', Audio: 'purgeAudio', Video: 'purgeVideo', Slide: 'purgeCustomSlide' } as const;

/** Each kind's icon at the start of its row (Trash.razor). */
function KindIcon({ kind }: { kind: TrashKind }) {
  const className = 'size-5';
  switch (kind) {
    case 'Presentation':
      return <MapIcon className={className} />;
    case 'Template':
      return <DocumentTextIcon className={className} />;
    case 'Song':
      return <MusicalNoteOutlineIcon className={className} strokeWidth={1.5} />;
    case 'Image':
      return <PhotoOutlineIcon className={className} strokeWidth={1.5} />;
    case 'Audio':
      return <SpeakerOutlineIcon className={className} />;
    case 'Video':
      return <VideoOutlineIcon className={className} />;
    case 'Slide':
      return <ShapesIcon className={className} />;
  }
}

function daysText(days: number) {
  if (days === 0) return t('trash.soon');
  if (days === 1) return t('trash.oneDay');
  return t('trash.days', { n: days });
}

/**
 * The trash (spec 03 section 5): the kinds the user may manage, newest
 * deletion first, to restore or purge. Opening it purges what has expired.
 */
/** The one trash, in Inställningar (Lars, 2026-11-02): every kind the user may manage, `kind` chosen first. */
export function Trash({ kind: initialKind, role }: { kind: TrashKind | null; role: Role }) {
  const db = useDb();
  const toast = useToast();
  const { dialog, ask } = useConfirm();
  const all = useData(listTrash, []);
  const [kind, setKind] = useState<TrashKind | null>(initialKind);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  /** The entry being restored: only its own Återställ waits (Trash.razor). */
  const [restoring, setRestoring] = useState<string | null>(null);
  const purgedOnOpen = useRef(false);
  const [now] = useState(Date.now); // days remaining count from when the page opened

  // The search waits 200 ms after the last keystroke; clearing is immediate (PRES-E17).
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search), 200);
    return () => clearTimeout(timer);
  }, [search]);

  const entries = all?.filter((e) => can(role, manages[e.kind])) ?? [];

  // Lazy purge of what has expired (PRES-R26). The server checks the age with its own clock too.
  useEffect(() => {
    if (!all || purgedOnOpen.current) return;
    purgedOnOpen.current = true;
    // Not asked for by the user, so a refusal is only logged; the entries stay in the list.
    if (all.some((e) => e.deletedAt <= now - TRASH_RETENTION_MS)) db.mutate('purgeExpiredTrash', { now }).catch((e: unknown) => console.error('save failed', e));
  }, [all, db, now]);

  const kinds = TRASH_KINDS.filter((k) => entries.some((e) => e.kind === k));
  const activeKind = kind && kinds.includes(kind) ? kind : null; // a kind that became empty falls back to everything (PRES-E16)
  const q = query.trim().toLocaleLowerCase('sv');
  const shown = entries.filter(
    (e) => (!activeKind || e.kind === activeKind) && (!q || e.name.toLocaleLowerCase('sv').includes(q) || (e.kind === 'Song' && e.detail?.toLocaleLowerCase('sv').includes(q))),
  );

  const run = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch {
      toast(t('common.error'));
    }
  };

  /** Kind and id together: two kinds could share an id. */
  const key = (e: TrashEntry) => `${e.kind}:${e.id}`;
  const restore = async (e: TrashEntry) => {
    if (restoring) return;
    setRestoring(key(e));
    try {
      await run(async () => {
        await db.mutate(restoreMutator[e.kind], { id: e.id });
        toast(t('trash.restored', { name: e.name }));
      });
    } finally {
      setRestoring(null);
    }
  };

  const purge = async (e: TrashEntry) => {
    await ask({ title: t('trash.purge'), text: t(`trash.purgeConfirm.${e.kind}`, { name: e.name }), bold: e.name, confirm: t('trash.purge'), busy: t('common.deleting'), run: () => run(() => db.mutate(purgeMutator[e.kind], { id: e.id })) });
  };

  // "Töm papperskorgen" empties everything the user may manage, not just what the filter shows.
  const empty = async () => {
    await ask({
      title: t('trash.empty'),
      text: t('trash.emptyConfirm', { n: entries.length }),
      confirm: t('trash.purge'),
      busy: t('common.deleting'),
      run: () => run(() => db.mutate('emptyTrash', {})),
    });
  };

  const count = shown.length === 1 ? t('trash.countOne') : t('trash.countMany', { n: shown.length });
  return (
    <PageContainer>
      {dialog}
      <PageHeader title={t('trash.title')} />
      {!all && <div className="loading-line px-5 py-4 text-stone-400 text-sm">{t('common.loading')}</div>}
      {all && !entries.length && (
        <EmptySmall icon={<TrashIcon className="size-12 mb-3 text-stone-300 dark:text-stone-600" strokeWidth={1.5} />} title={t('trash.emptyTitle')} />
      )}
      {/* As the other lists (Lars, 2026-11-03): the kinds and the search under the title, the list alone in its card,
          how many under it, and Töm papperskorgen as a red row last. */}
      {!!entries.length && (
        <>
          {/* Only the kinds that are in there: a tab that always says nothing is noise. */}
          {kinds.length > 1 && (
            <PillTabs label={t('trash.title')}>
              <PillTab active={activeKind === null} onClick={() => setKind(null)}>
                {t('trash.all')}
              </PillTab>
              {kinds.map((k) => (
                <PillTab key={k} active={activeKind === k} onClick={() => setKind(k)}>
                  {t(`trash.kind.${k}`)}
                </PillTab>
              ))}
            </PillTabs>
          )}
          <SearchField
            value={search}
            onChange={setSearch}
            onClear={() => {
              setSearch('');
              setQuery('');
            }}
            label={t('trash.search')}
            compact
            filled
          />
          <div className={CARD}>
            {!shown.length && <p className="px-5 py-10 text-center text-sm text-stone-400">{t('trash.noMatch')}</p>}
            {/* Newest first, so what was just deleted by mistake is the first thing in view. */}
            <ul aria-label={t('trash.title')}>
              {shown.map((e) => {
                const days = daysRemaining(e.deletedAt, now);
                // A presentation's date as the Swedish short date, "2026-11-01" (Trash.razor).
                const detail = e.template ? templateDetails(e.template) : e.detail;
                return (
                  <li key={key(e)} className="flex items-center gap-3 px-5 py-3 border-b border-separator last:border-b-0" aria-label={e.name}>
                    <div className="shrink-0 text-stone-400 dark:text-stone-500" title={t(`trash.one.${e.kind}`)}>
                      <KindIcon kind={e.kind} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{e.name}</div>
                      <div className="text-xs text-stone-400 truncate">
                        {[t(`trash.one.${e.kind}`), detail].filter(Boolean).join(' · ')}
                        {' · '}
                        <span className={days <= 1 ? 'text-red-500 dark:text-red-400' : undefined}>{daysText(days)}</span>
                      </div>
                    </div>
                    <AppButton variant="secondary" disabled={restoring === key(e)} onClick={() => void restore(e)}>
                      {t('common.restore')}
                    </AppButton>
                    <AppButton variant="danger" title={t('trash.purge')} aria-label={`${t('trash.purge')} ${e.name}`} onClick={() => void purge(e)}>
                      <TrashIcon className="size-4" />
                    </AppButton>
                  </li>
                );
              })}
            </ul>
          </div>
          <p className="text-center text-sm text-stone-500 dark:text-stone-400" data-testid="trash-count">
            {count}
            {shown.length !== entries.length && ` ${t('trash.countOf', { count: '', total: entries.length }).trim()}`}
          </p>
          <Group>
            <AppButton variant="plain" className={DANGER_ROW} onClick={() => void empty()}>
              {t('trash.empty')}
            </AppButton>
          </Group>
        </>
      )}
    </PageContainer>
  );
}
