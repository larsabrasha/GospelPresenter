import { useDataReading, useDb } from '../../db/react.tsx';
import { t } from '../../i18n.ts';
import { newId } from '../../ids.ts';
import { AddButton } from '../../ui/AddButton.tsx';
import { useTrySave } from '../../ui/AutoSave.tsx';
import { EmptySmall } from '../../ui/Empty.tsx';
import { DocumentDuplicateIcon } from '../../ui/icons.tsx';
import { ListCard, ListLinkRow } from '../../ui/List.tsx';
import { DetailHeader, PageContainer } from '../../ui/PageContainer.tsx';
import { href, navigate } from '../../ui/router.ts';
import { CALENDAR_READS, DEFAULT_FIELDS, eventTemplates } from './data.ts';
import { NEW_HOUR } from './NewEventDialog.tsx';

// The event templates (docs/planning.md, "Templates"), for an Admin: each opens as an event's page does, without a
// date. A new one starts with the usual fields, to change.

export function EventTemplates() {
  const db = useDb();
  const trySave = useTrySave();
  const templates = useDataReading(eventTemplates, [], CALENDAR_READS);
  const create = async () => {
    const id = newId();
    if (!(await trySave(db.mutate('createEvent', { id, title: t('eventTemplates.defaultName'), date: null, isTemplate: true, visibility: 'shown', ...NEW_HOUR, at: Date.now() })))) return;
    for (const name of DEFAULT_FIELDS) await trySave(db.mutate('addEventField', { id: newId(), eventId: id, name }));
    navigate({ page: 'event', id });
  };
  return (
    <PageContainer>
      <DetailHeader backHref={href({ page: 'presentations' })} title={t('eventTemplates.title')} />
      <div className="flex items-center justify-between px-2">
        <p className="text-sm text-stone-500 dark:text-stone-400">{t('eventTemplates.text')}</p>
        <AddButton label={t('eventTemplates.new')} onClick={() => void create()} />
      </div>
      {templates && !templates.length && <EmptySmall icon={<DocumentDuplicateIcon className="size-10 mb-3 text-stone-300 dark:text-stone-600" />} title={t('eventTemplates.empty')} />}
      {!!templates?.length && (
        <ListCard label={t('eventTemplates.title')}>
          {templates.map((tp) => (
            <ListLinkRow key={tp.id} href={href({ page: 'event', id: tp.id })} title={tp.title || t('calendar.untitled')} subtitle={[tp.time, tp.place, tp.fields.join(', ')].filter(Boolean).join(' · ') || undefined} />
          ))}
        </ListCard>
      )}
    </PageContainer>
  );
}
