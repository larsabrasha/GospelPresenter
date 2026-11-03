import { LIMITS, parsePartIds, type Label, type SongArrangement, type SongPart } from '@gp/core';
import { arrangementsOf, getSong, listLabels, songPartsOf } from '../db/queries.ts';
import { useData, useDb } from '../db/react.tsx';
import { t } from '../i18n.ts';
import { newId } from '../ids.ts';
import { AppButton } from '../ui/AppButton.tsx';
import { useSaveFailed } from '../ui/AutoSave.tsx';
import { afterWrite } from '../ui/debounce.ts';
import { ACTION_ROW, GROUP_ROW, Group, OpeningRow } from '../ui/Group.tsx';
import { ChevronRightIcon, PlusIcon } from '../ui/icons.tsx';
import { DetailHeader, PageContainer } from '../ui/PageContainer.tsx';
import { href, navigate } from '../ui/router.ts';
import { orderLine } from './PartPill.tsx';
import { useGoneSong } from './songPage.ts';

/** An arrangement's name where it shows: its own, "Arrangemang" when it is the only one, else "Arrangemang 2". */
export function arrangementTitle(a: SongArrangement, index: number, count: number): string {
  return a.name ?? (count === 1 ? t('song.arrangement') : `${t('song.arrangement')} ${index + 1}`);
}

/** What the Arrangemang row on a song's page says: the one arrangement's order, how many, or the parts' own order. */
export function arrangementSummary(arrangements: SongArrangement[], parts: SongPart[], labels: Map<string, Label>): string {
  if (arrangements.length > 1) return t('song.arrangementCount', { n: arrangements.length });
  return orderLine(arrangements[0] ? parsePartIds(arrangements[0].partIds) : parts.map((p) => p.id), parts, labels);
}

/** A song's arrangements and labels, for the pages pushed in from its page. */
export function useArrangementData(id: string) {
  return useData(
    async (d) => ({ song: await getSong(d, id), parts: await songPartsOf(d, [id]), arrangements: await arrangementsOf(d, [id]), labels: await listLabels(d) }),
    [id],
  );
}

/**
 * Arrangemang (spec 02), pushed in from a song's page as Historik is (Lars, 2026-11-03: as iOS's Settings pushes a
 * page): one group with a row for each arrangement, its name over its parts in a line when there are two or more, and
 * Nytt arrangemang as the group's last row. A song with none has one row, the parts' own order, which makes its first
 * arrangement. A row pushes its arrangement in.
 */
export function SongArrangements({ id }: { id: string }) {
  const db = useDb();
  const saveFailed = useSaveFailed();
  const data = useArrangementData(id);
  const missing = useGoneSong(!!data, data?.song);
  const header = <DetailHeader backHref={href({ page: 'song', id })} title={t('song.arrangements')} className="px-5" />;
  if (!data || missing)
    return (
      <PageContainer>
        {header}
        <div className="px-7 text-stone-400">{t('common.loading')}</div>
      </PageContainer>
    );
  const { arrangements, parts, labels } = data;
  /** A new arrangement of every part once, in order (SONG-A9), pushed in once it is there. */
  const create = () => {
    const arrangementId = newId();
    afterWrite(db.mutate('createArrangement', { id: arrangementId, songId: id, partIds: parts.map((p) => p.id) }), () => navigate({ page: 'songArrangement', id, arrangementId }), saveFailed);
  };
  const named = arrangements.length > 1;
  return (
    <PageContainer className="pb-8">
      {header}
      <Group>
        {arrangements.length ? (
          arrangements.map((a, i) => (
            <AppButton key={a.id} variant="plain" data-testid="arrangement-row" href={href({ page: 'songArrangement', id, arrangementId: a.id })} className={`${GROUP_ROW} w-full text-left no-underline text-inherit cursor-pointer hover:bg-raised`}>
              <span className="min-w-0">
                {named && <span className="block">{arrangementTitle(a, i, arrangements.length)}</span>}
                <span className={`block truncate ${named ? 'text-xs text-stone-500 dark:text-stone-400' : ''}`}>{orderLine(parsePartIds(a.partIds), parts, labels)}</span>
              </span>
              <ChevronRightIcon className="size-4 shrink-0 text-stone-400 dark:text-stone-600" />
            </AppButton>
          ))
        ) : (
          <OpeningRow label={arrangementSummary([], parts, labels)} onClick={create} testId="arrangement-row" />
        )}
        {arrangements.length > 0 && arrangements.length < LIMITS.arrangementsPerSong && (
          <AppButton variant="plain" className={`${ACTION_ROW} justify-start`} onClick={create}>
            <PlusIcon className="size-4" />
            {t('song.createArrangement')}
          </AppButton>
        )}
      </Group>
    </PageContainer>
  );
}
