import { useEffect, useEffectEvent, useState } from 'react';
import { getSong, songVersionsOf, themeOf } from '../db/queries.ts';
import { useData, useDb } from '../db/react.tsx';
import { t } from '../i18n.ts';
import { AppButton } from '../ui/AppButton.tsx';
import { useTrySave } from '../ui/AutoSave.tsx';
import { useConfirm } from '../ui/Dialog.tsx';
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon, ClockIcon } from '../ui/icons.tsx';
import { CARD } from '../ui/List.tsx';
import { CAPTION, GROUP_ROW, TEXT_ACTION } from '../ui/Group.tsx';
import { DetailHeader, PageContainer } from '../ui/PageContainer.tsx';
import { href, navigate } from '../ui/router.ts';
import { tileClass } from '../ui/SlideTile.tsx';
import { SlideView } from '../ui/SlideView.tsx';
import { versionClock, versionDay, versionSlides, versionTime } from './songHistory.ts';

/**
 * Historik (spec 02 `/admin/songs/{id}/history`; SongHistory.razor): the song's versions, newest first, and
 * the chosen one's parts as slides in the organisation's default theme; Återställ version gives the song
 * that version, after a question, and goes back to the song (SONG-R22).
 */
export function SongHistory({ id }: { id: string }) {
  const db = useDb();
  const trySave = useTrySave();
  const { dialog, ask } = useConfirm();
  const data = useData(async (d) => ({ song: await getSong(d, id), versions: await songVersionsOf(d, id), theme: await themeOf(d, null) }), [id]);
  const [chosen, setChosen] = useState<string | null>(null);
  /** A version opened on its own, where the column is too narrow to show it beside the list. */
  const [viewing, setViewing] = useState(false);
  // Escape goes back one step, from the version to the list (where the two are not side by side).
  useEffect(() => {
    if (!viewing) return;
    const back = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      setViewing(false);
    };
    addEventListener('keydown', back);
    return () => removeEventListener('keydown', back);
  }, [viewing]);

  // A song that is not there (gone, or in the trash) sends back to the list, as the song page does.
  const missing = !!data && (!data.song || data.song.deletedAt !== null);
  const leave = useEffectEvent(() => navigate({ page: 'songs' }));
  useEffect(() => {
    if (missing) leave();
  }, [missing]);

  const header = <DetailHeader backHref={href({ page: 'song', id })} title={t('history.title')} className="px-5" />;
  if (!data || missing)
    return (
      <PageContainer maxWidthClass="max-w-[1200px]">
        {header}
        <div className="px-7 text-stone-400">{t('common.loading')}</div>
      </PageContainer>
    );

  const { versions, theme } = data;
  // The newest until one is chosen, and again if the chosen one is dropped (SONG-R21).
  const version = versions.find((v) => v.id === chosen) ?? versions[0];
  const shown = version && versionSlides(version);
  // The versions in runs by day, newest first as they come.
  const days: { heading: string; versions: typeof versions }[] = [];
  for (const v of versions) {
    const heading = versionDay(v.createdAt);
    if (days.at(-1)?.heading === heading) days.at(-1)!.versions.push(v);
    else days.push({ heading, versions: [v] });
  }

  const restore = () => {
    if (!version) return;
    const time = versionTime(version.createdAt);
    void ask({
      title: t('history.restore'),
      text: t('history.restoreConfirm', { time }),
      bold: time,
      confirm: t('common.restore'),
      busy: t('history.restoring'),
      primary: true,
      run: async () => {
        if (await trySave(db.mutate('restoreSongVersion', { songId: id, versionId: version.id }))) navigate({ page: 'song', id });
      },
    });
  };

  return (
    <PageContainer maxWidthClass="max-w-[1200px]">
      {dialog}
      {header}
      {!version ? (
        <div className="flex flex-col items-center justify-center py-16 text-stone-400">
          <ClockIcon className="size-12 mb-3" />
          <span className="text-sm">{t('history.empty')}</span>
        </div>
      ) : (
        // Side by side when its own column is wide enough, not the window. Narrower (Inställningar's column on an iPad
        // held upright, a phone), as Mail and Notes: the versions by day, and one tapped opens on its own with ‹ back
        // (Lars, 2026-11-02: 50 versions above the preview would not do).
        <div className="@container">
          <div className="flex flex-col @xl:flex-row gap-4">
            <section className={`w-full @xl:w-72 shrink-0 self-start space-y-4 ${viewing ? '@max-xl:hidden' : ''}`} aria-label={t('history.versions')}>
              {days.map((day) => (
                <div key={day.heading} className="space-y-1.5">
                  <h2 className={CAPTION}>{day.heading}</h2>
                  <ul className={`${CARD} flex flex-col [&>li+li]:border-t-[0.5px] [&>li+li]:border-separator`}>
                    {day.versions.map((v) => (
                      <li key={v.id}>
                        <AppButton
                          variant="plain"
                          data-testid="version"
                          aria-pressed={v.id === version.id}
                          onClick={() => {
                            setChosen(v.id);
                            setViewing(true);
                          }}
                          className={`${GROUP_ROW} w-full text-left cursor-pointer hover:bg-raised`}
                        >
                          <span className="min-w-0">
                            <span className="block truncate dark:text-stone-100">{v.name}</span>
                            <span className="block text-xs text-stone-400">{versionClock(v.createdAt)}</span>
                          </span>
                          {/* The one shown, ticked where it is shown beside the list; a chevron where it opens. */}
                          {v.id === version.id && <CheckIcon className="size-4 shrink-0 text-sky-500 @max-xl:hidden" />}
                          <ChevronRightIcon className="size-4 shrink-0 text-stone-400 dark:text-stone-600 @xl:hidden" />
                        </AppButton>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </section>
            <section className={`flex-1 min-w-0 ${viewing ? '' : '@max-xl:hidden'}`} aria-label={t('history.preview')}>
              <AppButton variant="plain" className={`${TEXT_ACTION} -ml-4 -mt-2 @xl:hidden`} onClick={() => setViewing(false)}>
                <ChevronLeftIcon className="size-4" />
                {t('history.versions')}
              </AppButton>
              <div className="flex items-start justify-between mb-2 px-1 gap-3">
                <div className="min-w-0">
                  <div className="font-semibold text-sm dark:text-stone-100 truncate">{shown!.name}</div>
                  {shown!.author && <div className="text-xs text-stone-400 truncate">{shown!.author}</div>}
                  <div className="text-xs text-stone-400 mt-0.5">{versionTime(version.createdAt)}</div>
                </div>
                <AppButton className="shrink-0" onClick={restore}>
                  {t('history.restore')}
                </AppButton>
              </div>
              <div className="flex flex-col gap-2">
                {shown!.slides.map((s) => (
                  <div key={s.key} className={`${tileClass({ interactive: false })} w-full max-w-[480px]`}>
                    <SlideView slide={s} theme={theme} credits={false} />
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      )}
    </PageContainer>
  );
}
