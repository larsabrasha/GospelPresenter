import { EVENT_LIMITS, type FieldEntry, type Visibility } from '@gp/core';
import { useState } from 'react';
import { withMaxChars } from '../../ui/maxChars.ts';
import { useDataReading, useDb } from '../../db/react.tsx';
import { t } from '../../i18n.ts';
import { newId } from '../../ids.ts';
import { AppButton } from '../../ui/AppButton.tsx';
import { AutoSaveField, useTrySave } from '../../ui/AutoSave.tsx';
import { useConfirm } from '../../ui/Dialog.tsx';
import { CAPTION, DANGER_ROW, Group, GROUP_ROW, SwitchRow, TEXT_ACTION } from '../../ui/Group.tsx';
import { DesktopIcon, PlusIcon } from '../../ui/icons.tsx';
import { RowChevron, ROW_HOVER } from '../../ui/List.tsx';
import { MoreMenu } from '../../ui/MoreMenu.tsx';
import { NameDialog } from '../../ui/NameDialog.tsx';
import { DetailHeader, PageContainer } from '../../ui/PageContainer.tsx';
import { loadingText } from '../../ui/playful.ts';
import { Segmented } from '../../ui/Segmented.tsx';
import { href, navigate } from '../../ui/router.ts';
import { CALENDAR_READS, eventPage, eventSuggestions, usePeople, type EventField, type EventPage as Page } from './data.ts';
import { FieldEntries } from './FieldEntries.tsx';

// An event's page, or a template's (docs/planning.md): when and where, the description, who does what, who may see
// it outside the church, and the presentation on the screen. Every field saves as it is changed.

const PILL = 'h-9 px-3 rounded-lg bg-raised dark:bg-raised-2 tabular-nums outline-none focus:ring-2 focus:ring-sky-500 dark:scheme-dark';
/** A form's column on a computer: narrower than a list's, so a row's name and its value stay near (Lars, 2026-11-28). */
const NARROW = 'sm:w-140';
/** A card whose rows may open a list over it (FieldEntries): CARD without its overflow-hidden. */
const OPEN_CARD = 'bg-surface rounded-xl border-[0.5px] border-separator flex flex-col [&>*+*]:border-t-[0.5px] [&>*+*]:border-separator';

export function EventPage({ id }: { id: string }) {
  const db = useDb();
  const trySave = useTrySave();
  const page = useDataReading((d) => eventPage(d, id), [id], CALENDAR_READS);
  const { dialog, ask } = useConfirm();
  if (page === undefined) return <PageContainer><p className="loading-line px-4 py-3 text-stone-400">{loadingText()}</p></PageContainer>;
  if (page === null || page.deletedAt !== null)
    return (
      <PageContainer>
        <DetailHeader backHref={href({ page: 'presentations' })} title={t('event.notFound')} />
      </PageContainer>
    );
  const save = (args: Record<string, unknown>) => trySave(db.mutate('updateEvent', { id, ...args, at: Date.now() }));
  const allDay = !page.time;
  const back = page.isTemplate ? href({ page: 'eventTemplates' }) : href({ page: 'presentations' });
  const remove = () =>
    ask({
      title: page.isTemplate ? t('event.deleteTemplate') : t('event.delete'),
      text: t('event.deleteText', { name: page.title || t('calendar.untitled') }),
      bold: page.title || undefined,
      confirm: t('common.delete'),
      busy: t('common.deleting'),
      run: async () => {
        if (await trySave(db.mutate('trashEvent', { id, at: Date.now() }))) navigate(page.isTemplate ? { page: 'eventTemplates' } : { page: 'presentations' });
      },
    });

  return (
    <PageContainer maxWidthClass={NARROW}>
      {dialog}
      <DetailHeader backHref={back} title={page.title || t('calendar.untitled')} />
      <Group title={page.isTemplate ? t('event.template') : undefined}>
        <AutoSaveField bare label={t('event.title')} showLabel value={page.title} maxChars={EVENT_LIMITS.title} onSave={(v) => save({ title: v })} />
        {/* Hela dagen, as iOS's Calendar: an event has times or is all day; no time is all day (Lars, 2026-11-28). Turned
            off, it takes 11–12 to change, as iOS gives a new event an hour. */}
        <SwitchRow title={t('event.allDay')} checked={allDay} onChange={(on) => void save(on ? { time: null, endTime: null } : { time: '11:00', endTime: '12:00' })} />
        {/* Börjar and Slutar, each its date and time side by side, as Apple's Calendar (Lars, 2026-11-28). A template
            all day has neither: no date and no time. */}
        {!(page.isTemplate && allDay) && (
          <>
            <div className={GROUP_ROW}>
              <span>{t('event.starts')}</span>
              <span className="flex items-center gap-2">
                {!page.isTemplate && (
                  <input type="date" required aria-label={t('event.date')} className={PILL} value={page.date ?? ''} onChange={(e) => e.target.value && void save({ date: e.target.value })} />
                )}
                {!allDay && <input type="time" aria-label={t('event.time')} className={PILL} value={page.time ?? ''} onChange={(e) => void save({ time: e.target.value || null })} />}
              </span>
            </div>
            <div className={GROUP_ROW}>
              <span>{t('event.ends')}</span>
              <span className="flex items-center gap-2">
                {!page.isTemplate && (
                  <input type="date" aria-label={t('event.endDate')} className={PILL} value={page.endDate ?? ''} onChange={(e) => void save({ endDate: e.target.value || null })} />
                )}
                {!allDay && <input type="time" aria-label={t('event.endTime')} className={PILL} value={page.endTime ?? ''} onChange={(e) => void save({ endTime: e.target.value || null })} />}
              </span>
            </div>
          </>
        )}
        <AutoSaveField bare label={t('event.place')} showLabel value={page.place ?? ''} maxChars={100} onSave={(v) => save({ place: v })} />
      </Group>
      <Group title={t('event.description')} footer={t('event.descriptionHint')}>
        <AutoSaveField bare multiline rows={3} label={t('event.description')} value={page.description ?? ''} maxChars={5000} onSave={(v) => save({ description: v })} />
      </Group>
      <Fields page={page} />
      <Visibility page={page} onSave={save} />
      {!page.isTemplate && <OnScreen page={page} />}
      <Group>
        <AppButton variant="plain" className={DANGER_ROW} onClick={remove}>
          {page.isTemplate ? t('event.deleteTemplate') : t('event.delete')}
        </AppButton>
      </Group>
    </PageContainer>
  );
}

/** Vem gör vad: a row per field, its name and what is in it, and Lägg till uppgift. */
function Fields({ page }: { page: Page }) {
  const db = useDb();
  const trySave = useTrySave();
  const people = usePeople();
  const suggestions = useDataReading(eventSuggestions, [], ['events', 'event_fields']);
  const [renaming, setRenaming] = useState<EventField | null>(null);
  const [adding, setAdding] = useState('');
  const add = (name: string) => {
    const n = name.trim().slice(0, EVENT_LIMITS.fieldName);
    setAdding('');
    if (n) void trySave(db.mutate('addEventField', { id: newId(), eventId: page.id, name: n }));
  };
  const setEntries = (f: EventField, entries: FieldEntry[]) => void trySave(db.mutate('updateEventField', { id: f.id, entries }));
  const full = page.fields.length >= EVENT_LIMITS.fieldsPerEvent;
  return (
    <section aria-label={t('event.who')} className="space-y-1.5">
      <h2 className={CAPTION}>{t('event.who')}</h2>
      <div className={OPEN_CARD}>
        {page.fields.map((f, i) => (
          <div key={f.id} className="flex items-center gap-3 pl-4 pr-1 min-h-11">
            <span className="w-28 sm:w-36 shrink-0 text-sm text-stone-500 dark:text-stone-400 truncate" title={f.name}>
              {f.name}
            </span>
            <FieldEntries label={f.name} entries={f.entries} people={people} texts={suggestions?.texts[f.name] ?? []} onChange={(e) => setEntries(f, e)} />
            <MoreMenu
              name={f.name}
              choices={[
                { label: t('event.renameField'), onChoose: () => setRenaming(f) },
                { label: t('event.moveUp'), disabled: i === 0, onChoose: () => void trySave(db.mutate('moveEventField', { id: f.id, to: i - 1 })) },
                { label: t('event.moveDown'), disabled: i === page.fields.length - 1, onChoose: () => void trySave(db.mutate('moveEventField', { id: f.id, to: i + 1 })) },
                { label: t('event.removeField', { name: f.name }), danger: true, onChoose: () => void trySave(db.mutate('removeEventField', { id: f.id })) },
              ]}
            />
          </div>
        ))}
        {!full && (
          <form className="flex items-center gap-2 px-4 min-h-11" onSubmit={(e) => (e.preventDefault(), add(adding))}>
            <PlusIcon className="size-4 text-sky-600 dark:text-sky-400" />
            <input
              aria-label={t('event.addField')}
              placeholder={t('event.addField')}
              list={`names-${page.id}`}
              value={adding}
              onChange={withMaxChars(EVENT_LIMITS.fieldName, (e) => setAdding(e.target.value))}
              className="flex-1 bg-transparent outline-none text-sm py-2 placeholder:text-sky-600 dark:placeholder:text-sky-400"
            />
            <datalist id={`names-${page.id}`}>{(suggestions?.fieldNames ?? []).filter((n) => !page.fields.some((f) => f.name === n)).map((n) => <option key={n} value={n} />)}</datalist>
            {adding.trim() && (
              <AppButton type="submit" variant="plain" className={TEXT_ACTION}>
                {t('presentation.add')}
              </AppButton>
            )}
          </form>
        )}
      </div>
      {renaming && (
        <NameDialog
          title={t('event.renameField')}
          label={t('event.fieldName')}
          maxChars={EVENT_LIMITS.fieldName}
          initial={renaming.name}
          onClose={() => setRenaming(null)}
          submit={async (name) => {
            if (await trySave(db.mutate('updateEventField', { id: renaming.id, name }))) setRenaming(null);
          }}
        />
      )}
    </section>
  );
}

/** Who may see the event outside the church; the word a busy one is shown with. */
function Visibility({ page, onSave }: { page: Page; onSave: (a: Record<string, unknown>) => Promise<boolean> }) {
  return (
    <Group title={t('event.visibility')} footer={t('event.visibilityHint')}>
      <div className="px-3 py-2">
        <Segmented<Visibility>
          label={t('event.visibility')}
          options={[
            { key: 'hidden', label: t('event.visibility.hidden') },
            { key: 'busy', label: t('event.visibility.busy') },
            { key: 'shown', label: t('event.visibility.shown') },
          ]}
          value={page.visibility}
          onChange={(v) => void onSave({ visibility: v })}
        />
      </div>
      {page.visibility === 'busy' && (
        <AutoSaveField bare showLabel label={t('event.busyWord')} value={page.busyWord ?? ''} maxChars={EVENT_LIMITS.busyWord} onSave={(v) => onSave({ busyWord: v })} />
      )}
    </Group>
  );
}

/** På skärmen: the presentation linked, as a row that opens it, or Skapa presentation. */
function OnScreen({ page }: { page: Page }) {
  const db = useDb();
  const trySave = useTrySave();
  const p = page.presentation;
  const create = async () => {
    const presentationId = newId();
    const name = page.title.trim() || t('presentations.defaultName');
    if (await trySave(db.mutate('createPresentationForEvent', { eventId: page.id, presentationId, name, at: Date.now() }))) navigate({ page: 'presentation', id: presentationId });
  };
  return (
    <Group title={t('event.screen')} footer={p ? t('event.presentationAlsoThere') : undefined}>
      {p ? (
        <a href={href({ page: 'presentation', id: p.id })} className={`flex items-center gap-3 px-4 py-3 no-underline text-inherit ${ROW_HOVER}`}>
          <span className="size-9 shrink-0 rounded-lg grid place-items-center bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-200">
            <DesktopIcon className="size-5" />
          </span>
          <span className="flex-1 min-w-0">
            <span className="block truncate font-medium">{p.name}</span>
            <span className="block text-xs text-stone-400 dark:text-stone-500">{p.items ? t('event.presentationItems', { n: p.items }) : t('event.presentationNoItems')}</span>
          </span>
          <RowChevron />
        </a>
      ) : (
        <div className="px-4 py-3 space-y-3">
          <p className="text-sm text-stone-500 dark:text-stone-400">{t('event.noPresentation')}</p>
          <AppButton onClick={() => void create()}>
            <DesktopIcon className="size-4" />
            {t('event.createPresentation')}
          </AppButton>
        </div>
      )}
    </Group>
  );
}
