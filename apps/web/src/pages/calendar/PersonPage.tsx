import { useEffect, useState } from 'react';
import { api } from '../../auth/api.ts';
import { useDataReading } from '../../db/react.tsx';
import { t } from '../../i18n.ts';
import { Group, GROUP_ROW } from '../../ui/Group.tsx';
import { ListCard, ListLinkRow } from '../../ui/List.tsx';
import { DetailHeader, PageContainer } from '../../ui/PageContainer.tsx';
import { initials } from '../../ui/syncState.ts';
import { href } from '../../ui/router.ts';
import { fullDate, localToday } from '../dashboard.ts';
import { DateTile } from '../StartRows.tsx';
import { CALENDAR_READS, personEvents, usePeople, whenText } from './data.ts';

// A member as a field names them (docs/planning.md, "A person"): their name, their coming events with the fields they
// are in, and, for an Admin, their address, as Användare shows it.

export function PersonPage({ id, admin }: { id: string; admin: boolean }) {
  const today = localToday();
  const people = usePeople();
  const events = useDataReading((db) => personEvents(db, id, today), [id, today], CALENDAR_READS);
  const [email, setEmail] = useState<string | null>(null);
  useEffect(() => {
    if (!admin) return;
    void api<{ email: string | null }>('GET', `/api/users/${encodeURIComponent(id)}`).then((r) => setEmail(r.error ? null : r.body.email));
  }, [id, admin]);
  const name = people.find((p) => p.id === id)?.name;
  return (
    <PageContainer>
      <DetailHeader backHref={href({ page: 'presentations' })} title={name ?? t('person.title')} />
      <div className="flex flex-col items-center gap-2 py-2">
        <span aria-hidden="true" className="size-20 rounded-full grid place-items-center bg-stone-300 dark:bg-stone-600 text-white text-2xl font-semibold">
          {initials(name ?? '')}
        </span>
        <h1 className="text-xl font-semibold">{name ?? t('person.unknown')}</h1>
      </div>
      {admin && email && (
        <Group>
          <div className={GROUP_ROW}>
            <span>{t('person.email')}</span>
            <span className="text-stone-500 dark:text-stone-400 truncate select-all">{email}</span>
          </div>
        </Group>
      )}
      <section className="space-y-2">
        <h2 className="text-sm/5 font-semibold text-stone-500 dark:text-stone-400 px-5">{t('person.coming')}</h2>
        {events && !events.length && <p className="px-5 text-sm text-stone-400">{t('person.none')}</p>}
        {!!events?.length && (
          <ListCard label={t('person.coming')}>
            {events.map((e) => (
              <ListLinkRow
                key={e.id}
                href={href({ page: 'event', id: e.id })}
                start={<DateTile date={e.date} today={e.date === today} />}
                title={e.title || t('calendar.untitled')}
                subtitle={[whenText(e), e.fields.join(', ')].filter(Boolean).join(' · ')}
                subtitleTitle={e.date ? fullDate(e.date) : undefined}
              />
            ))}
          </ListCard>
        )}
      </section>
    </PageContainer>
  );
}
