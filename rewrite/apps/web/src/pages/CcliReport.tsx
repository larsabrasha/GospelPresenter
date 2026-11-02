import { can, type CcliEntry, type Role } from '@gp/core';
import { useState } from 'react';
import { ccliCollectionOn, listCcliEntries } from '../db/queries.ts';
import { useData, useDb } from '../db/react.tsx';
import { t } from '../i18n.ts';
import { AppButton } from '../ui/AppButton.tsx';
import { useTrySave } from '../ui/AutoSave.tsx';
import { EmptyPicture, PICTURE } from '../ui/Empty.tsx';
import { CcliPicture } from '../ui/icons.tsx';
import { CARD } from '../ui/List.tsx';
import { PageContainer, PageHeader } from '../ui/PageContainer.tsx';
import { PillTab, PillTabs } from '../ui/PillTabs.tsx';
import { SWITCH } from '../ui/Toggle.tsx';
import { cardKey, ccliCards, ccliFilters, matchesFilter, type CcliFilter } from './ccliReport.ts';

/** At most this many entries at first, and this many more per "Visa fler" (SONG-R52). */
const PAGE = 50;

/** The collection switch's key among the switches asked for. */
const COLLECTION = 'collection';

const allReported = (entries: CcliEntry[]) => entries.every((e) => e.reportedAt !== null);

/** When a card is marked reported. */
const now = () => Date.now();

/**
 * CCLI-rapport (spec 02 `/admin/ccli-report`; CcliReport.razor): collection on or off, and the entries in a card per
 * day and presentation (02 Q13 as decided on 2026-10-31), each card marked reported at once. A card marked under a
 * filter it no longer matches stays until the filter changes, as it did.
 */
export function CcliReport({ role }: { role: Role }) {
  const db = useDb();
  const trySave = useTrySave();
  const data = useData(async (d) => ({ entries: await listCcliEntries(d), on: await ccliCollectionOn(d) }), []);
  const [filter, setFilter] = useState<CcliFilter>('all');
  const [kept, setKept] = useState<Set<string>>(new Set());
  const [shown, setShown] = useState(PAGE);
  // A switch moves at once, as it did (optimistic): what was asked for shows until the data has it, or the write is refused.
  const [asked, setAsked] = useState<Map<string, boolean>>(new Map());
  const settled = data ? [...asked].filter(([key, on]) => (key === COLLECTION ? data.on : allReported(data.entries.filter((e) => cardKey(e) === key))) === on) : [];
  if (settled.length) setAsked((a) => new Map([...a].filter(([key]) => !settled.some(([k]) => k === key))));
  const ask = (key: string, on: boolean, write: Promise<void>) => {
    setAsked((a) => new Map(a).set(key, on));
    void trySave(write).then((ok) => {
      if (!ok)
        setAsked((a) => {
          const next = new Map(a);
          next.delete(key);
          return next;
        });
    });
  };

  const choose = (f: CcliFilter) => {
    setFilter(f);
    setKept(new Set());
    setShown(PAGE);
  };
  const matching = data?.entries.filter((e) => matchesFilter(e, filter) || kept.has(e.id)) ?? [];
  const cards = ccliCards(matching.slice(0, shown));

  const mark = (key: string, entries: CcliEntry[], reported: boolean) => {
    setKept((k) => new Set([...k, ...entries.map((e) => e.id)]));
    ask(key, reported, db.mutate('setCcliReported', { ids: entries.map((e) => e.id), reported, at: now() }));
  };

  return (
    <PageContainer>
      <PageHeader title={t('ccli.title')} />
      <div className="px-5 pb-2">
        <label className="flex items-center gap-3 cursor-pointer select-none w-fit">
          <input
            // A new switch once the setting has loaded, so it shows as it is rather than sliding there.
            key={data ? 'loaded' : 'loading'}
            type="checkbox"
            className={SWITCH}
            checked={asked.get(COLLECTION) ?? !!data?.on}
            disabled={!data || !can(role, 'ManageOrganizationSettings')}
            onChange={(e) => ask(COLLECTION, e.target.checked, db.mutate('setCcliCollection', { on: e.target.checked }))}
          />
          <span className="text-sm dark:text-stone-200">{t('ccli.collection')}</span>
        </label>
        <p className="text-xs text-stone-400 dark:text-stone-500 mt-1 ml-12">{t('ccli.collectionText')}</p>
      </div>
      <div className="px-5 pb-2">
        <PillTabs label={t('ccli.filter')}>
          {ccliFilters.map((f) => (
            <PillTab key={f} active={filter === f} onClick={() => choose(f)}>
              {t(f === 'all' ? 'ccli.all' : f === 'unreported' ? 'ccli.unreported' : 'ccli.reportedFilter')}
            </PillTab>
          ))}
        </PillTabs>
      </div>
      {!data ? (
        <div className="px-7 py-4 text-stone-400">{t('common.loading')}</div>
      ) : !cards.length ? (
        <div className={`${CARD} overflow-hidden`}>
          <EmptyPicture picture={<CcliPicture className={PICTURE} />} title={t('ccli.empty')} />
        </div>
      ) : (
        <>
          {cards.map((c) => {
            const name = c.presentationName || t('ccli.other');
            const reported = asked.get(c.key) ?? allReported(c.entries);
            return (
              <section key={c.key} aria-label={`${name} ${c.date}`} className={`${CARD} overflow-hidden`}>
                <div className="flex items-center justify-between gap-3 px-5 py-3 bg-stone-100 dark:bg-raised/50">
                  <div className="min-w-0">
                    <div className="font-semibold dark:text-stone-100 truncate">{name}</div>
                    <div className="text-xs text-stone-400 dark:text-stone-500">{c.date}</div>
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer select-none shrink-0">
                    <span className="text-xs text-stone-400 dark:text-stone-500">{t('ccli.reported')}</span>
                    <input
                      type="checkbox"
                      className={SWITCH}
                      aria-label={t('ccli.reportedFor', { name, date: c.date })}
                      checked={reported}
                      disabled={!can(role, 'ManageCcliReport')}
                      onChange={() => mark(c.key, c.entries, !reported)}
                    />
                  </label>
                </div>
                <ul>
                  {c.entries.map((e) => (
                    <li key={e.id} className="flex items-center px-5 py-2.5 border-t-[0.5px] border-separator">
                      <div className="w-0 sm:w-28 overflow-hidden shrink-0 text-sm text-stone-500 dark:text-stone-400">{e.ccli}</div>
                      <div className="flex-1 min-w-0">
                        <div className="truncate">{e.songName}</div>
                        <div className="sm:hidden text-xs text-stone-500 dark:text-stone-400">{e.ccli}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
          {matching.length > shown && (
            <div className="flex justify-center py-4">
              <AppButton variant="cancel" onClick={() => setShown((n) => n + PAGE)}>
                {t('common.showMore')}
              </AppButton>
            </div>
          )}
        </>
      )}
    </PageContainer>
  );
}
