import { can, daysRemaining, TRASH_RETENTION_MS, type Role } from '@gp/core';
import { useEffect, useRef, useState } from 'react';
import { useData, useDb } from '../db/react.tsx';
import { listTrash, type TrashEntry } from '../db/queries.ts';
import { t } from '../i18n.ts';
import { Button } from '../ui/Button.tsx';
import { useConfirm } from '../ui/Dialog.tsx';
import { href, TRASH_KINDS, type TrashKind } from '../ui/router.ts';
import { useToast } from '../ui/Toast.tsx';
import { formatEventDate } from './PresentationEditor.tsx';

const manages: Record<TrashKind, Parameters<typeof can>[1]> = { Presentation: 'ManagePresentations', Song: 'ManageSongs' };

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
      await db.mutate(e.kind === 'Song' ? 'restoreSong' : 'restorePresentation', { id: e.id });
      toast(t('trash.restored', { name: e.name }));
    });

  const purge = async (e: TrashEntry) => {
    const ok = await ask({ title: t('trash.purge'), text: t(`trash.purgeConfirm.${e.kind}`, { name: e.name }), confirm: t('common.delete') });
    if (ok) await run(() => db.mutate(e.kind === 'Song' ? 'purgeSong' : 'purgePresentation', { id: e.id }));
  };

  // "Töm papperskorgen" empties everything the user may manage, not just what the filter shows.
  const empty = async () => {
    const ok = await ask({ title: t('trash.empty'), text: t('trash.emptyConfirm', { n: entries.length }), confirm: t('common.delete') });
    if (!ok) return;
    await run(async () => {
      for (const e of entries) await db.mutate(e.kind === 'Song' ? 'purgeSong' : 'purgePresentation', { id: e.id });
    });
  };

  const count = shown.length === 1 ? t('trash.countOne') : t('trash.countMany', { n: shown.length });
  return (
    <section>
      {dialog}
      <div className="row">
        <a href={href({ page: 'presentations' })} aria-label={t('common.back')}>
          ←
        </a>
        <h1 className="grow">{t('trash.title')}</h1>
      </div>
      {all && !entries.length && (
        <div className="empty">
          <p>
            <strong>{t('trash.emptyTitle')}</strong>
          </p>
          <p className="muted">{t('trash.emptyText')}</p>
        </div>
      )}
      {!!entries.length && (
        <>
          <div className="row">
            <span className="grow" data-testid="trash-count">
              {shown.length === entries.length ? count : t('trash.countOf', { count, total: entries.length })}
            </span>
            <Button variant="danger" disabled={busy} onClick={() => void empty()}>
              {t('trash.empty')}
            </Button>
          </div>
          {kinds.length > 1 && (
            <div className="row" role="group" aria-label={t('trash.title')}>
              <Button className="pill-button" aria-pressed={activeKind === null} onClick={() => setKind(null)}>
                {t('trash.all')}
              </Button>
              {kinds.map((k) => (
                <Button key={k} className="pill-button" aria-pressed={activeKind === k} onClick={() => setKind(k)}>
                  {t(`trash.kind.${k}`)}
                </Button>
              ))}
            </div>
          )}
          <div className="row">
            <input
              className="search grow"
              type="search"
              maxLength={100}
              aria-label={t('trash.search')}
              placeholder={t('trash.search')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <Button
                aria-label={t('common.clear')}
                onClick={() => {
                  setSearch('');
                  setQuery('');
                }}
              >
                ×
              </Button>
            )}
          </div>
          {!shown.length && <p className="muted">{t('trash.noMatch')}</p>}
          <ul className="list" aria-label={t('trash.title')}>
            {shown.map((e) => {
              const days = daysRemaining(e.deletedAt, now);
              const detail = e.kind === 'Presentation' && e.detail ? formatEventDate(e.detail) : e.detail;
              return (
                <li key={`${e.kind}:${e.id}`} className="row" aria-label={e.name}>
                  <div className="grow">
                    <strong>{e.name}</strong>
                    <div className="muted">
                      {[t(`trash.one.${e.kind}`), detail].filter(Boolean).join(' · ')}
                      {' · '}
                      <span className={days <= 1 ? 'danger' : undefined}>{daysText(days)}</span>
                    </div>
                  </div>
                  <Button disabled={busy} onClick={() => void restore(e)}>
                    {t('common.restore')}
                  </Button>
                  <Button variant="danger" disabled={busy} aria-label={`${t('trash.purge')} ${e.name}`} onClick={() => void purge(e)}>
                    🗑
                  </Button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
