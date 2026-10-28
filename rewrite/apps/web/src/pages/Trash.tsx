import { can, daysRemaining, TRASH_RETENTION_MS, type Role } from '@gp/core';
import { useEffect, useRef, useState } from 'react';
import { useData, useDb } from '../db/react.tsx';
import { listTrash, type TrashEntry } from '../db/queries.ts';
import { t } from '../i18n.ts';
import { AppButton } from '../ui/AppButton.tsx';
import { useConfirm } from '../ui/Dialog.tsx';
import { MapIcon, MusicalNoteOutlineIcon, PhotoOutlineIcon, SpeakerOutlineIcon, TrashIcon } from '../ui/icons.tsx';
import { CARD } from '../ui/List.tsx';
import { DetailHeader, PageContainer } from '../ui/PageContainer.tsx';
import { SearchField } from '../ui/Picker.tsx';
import { PillTab, PillTabs } from '../ui/PillTabs.tsx';
import { href, TRASH_KINDS, type TrashKind } from '../ui/router.ts';
import { useToast } from '../ui/Toast.tsx';
import { formatEventDate } from './presentation-editor/index.ts';

const manages: Record<TrashKind, Parameters<typeof can>[1]> = { Presentation: 'ManagePresentations', Song: 'ManageSongs', Image: 'ManageImages', Audio: 'ManageAudios' };
const restoreMutator = { Presentation: 'restorePresentation', Song: 'restoreSong', Image: 'restoreImage', Audio: 'restoreAudio' } as const;
const purgeMutator = { Presentation: 'purgePresentation', Song: 'purgeSong', Image: 'purgeImage', Audio: 'purgeAudio' } as const;

/** Each kind's icon at the start of its row (Trash.razor). */
function KindIcon({ kind }: { kind: TrashKind }) {
  const className = 'size-5';
  switch (kind) {
    case 'Presentation':
      return <MapIcon className={className} />;
    case 'Song':
      return <MusicalNoteOutlineIcon className={className} strokeWidth={1.5} />;
    case 'Image':
      return <PhotoOutlineIcon className={className} strokeWidth={1.5} />;
    case 'Audio':
      return <SpeakerOutlineIcon className={className} />;
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
export function Trash({ kind: initialKind, role }: { kind: TrashKind | null; role: Role }) {
  const db = useDb();
  const toast = useToast();
  const { dialog, ask } = useConfirm();
  const all = useData(listTrash, []);
  const [kind, setKind] = useState<TrashKind | null>(initialKind);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
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
    if (all.some((e) => e.deletedAt <= now - TRASH_RETENTION_MS)) void db.mutate('purgeExpiredTrash', { now });
  }, [all, db, now]);

  const kinds = TRASH_KINDS.filter((k) => entries.some((e) => e.kind === k));
  const activeKind = kind && kinds.includes(kind) ? kind : null; // a kind that became empty falls back to everything (PRES-E16)
  const q = query.trim().toLocaleLowerCase('sv');
  const shown = entries.filter(
    (e) => (!activeKind || e.kind === activeKind) && (!q || e.name.toLocaleLowerCase('sv').includes(q) || (e.kind === 'Song' && e.detail?.toLocaleLowerCase('sv').includes(q))),
  );

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch {
      toast(t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  const restore = (e: TrashEntry) =>
    run(async () => {
      await db.mutate(restoreMutator[e.kind], { id: e.id });
      toast(t('trash.restored', { name: e.name }));
    });

  const purge = async (e: TrashEntry) => {
    const ok = await ask({ title: t('trash.purge'), text: t(`trash.purgeConfirm.${e.kind}`, { name: e.name }), confirm: t('common.delete') });
    if (ok) await run(() => db.mutate(purgeMutator[e.kind], { id: e.id }));
  };

  // "Töm papperskorgen" empties everything the user may manage, not just what the filter shows.
  const empty = async () => {
    const ok = await ask({ title: t('trash.empty'), text: t('trash.emptyConfirm', { n: entries.length }), confirm: t('common.delete') });
    if (!ok) return;
    await run(async () => {
      for (const e of entries) await db.mutate(purgeMutator[e.kind], { id: e.id });
    });
  };

  const count = shown.length === 1 ? t('trash.countOne') : t('trash.countMany', { n: shown.length });
  return (
    <PageContainer>
      {dialog}
      <DetailHeader backHref={href({ page: 'presentations' })} title={t('trash.title')} className="px-5" />
      <div className={CARD}>
        {all && !entries.length && (
          <div className="flex flex-col items-center justify-center py-16 text-neutral-400">
            <TrashIcon className="size-12 mb-3" strokeWidth={1.5} />
            <p className="text-sm">{t('trash.emptyTitle')}</p>
            <p className="text-xs mt-1 max-w-xs text-center">{t('trash.emptyText')}</p>
          </div>
        )}
        {!!entries.length && (
          <>
            <div className="px-5 pt-4 pb-2 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-semibold" data-testid="trash-count">
                  {count}
                  {shown.length !== entries.length && (
                    <>
                      {' '}
                      <span className="font-normal text-neutral-400 text-sm">{t('trash.countOf', { count: '', total: entries.length }).trim()}</span>
                    </>
                  )}
                </div>
                <AppButton variant="danger" disabled={busy} onClick={() => void empty()}>
                  {t('trash.empty')}
                </AppButton>
              </div>
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
              />
            </div>
            {!shown.length && <p className="px-5 py-10 text-center text-sm text-neutral-400">{t('trash.noMatch')}</p>}
            {/* Newest first, so what was just deleted by mistake is the first thing in view. */}
            <ul aria-label={t('trash.title')}>
              {shown.map((e) => {
                const days = daysRemaining(e.deletedAt, now);
                const detail = e.kind === 'Presentation' && e.detail ? formatEventDate(e.detail) : e.detail;
                return (
                  <li key={`${e.kind}:${e.id}`} className="flex items-center gap-3 px-5 py-3 border-b border-neutral-200 dark:border-neutral-700 last:border-b-0" aria-label={e.name}>
                    <div className="shrink-0 text-neutral-400 dark:text-neutral-500" title={t(`trash.one.${e.kind}`)}>
                      <KindIcon kind={e.kind} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{e.name}</div>
                      <div className="text-xs text-neutral-400 truncate">
                        {[t(`trash.one.${e.kind}`), detail].filter(Boolean).join(' · ')}
                        {' · '}
                        <span className={days <= 1 ? 'text-red-500 dark:text-red-400' : undefined}>{daysText(days)}</span>
                      </div>
                    </div>
                    <AppButton variant="secondary" disabled={busy} onClick={() => void restore(e)}>
                      {t('common.restore')}
                    </AppButton>
                    <AppButton variant="danger" disabled={busy} title={t('trash.purge')} aria-label={`${t('trash.purge')} ${e.name}`} onClick={() => void purge(e)}>
                      <TrashIcon className="size-4" />
                    </AppButton>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </PageContainer>
  );
}
