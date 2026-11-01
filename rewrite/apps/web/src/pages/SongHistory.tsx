import { useEffect, useEffectEvent, useState } from 'react';
import { getSong, songVersionsOf, themeOf } from '../db/queries.ts';
import { useData, useDb } from '../db/react.tsx';
import { t } from '../i18n.ts';
import { AppButton } from '../ui/AppButton.tsx';
import { useTrySave } from '../ui/AutoSave.tsx';
import { useConfirm } from '../ui/Dialog.tsx';
import { ClockIcon } from '../ui/icons.tsx';
import { DetailHeader, PageContainer } from '../ui/PageContainer.tsx';
import { href, navigate } from '../ui/router.ts';
import { tileClass } from '../ui/SlideTile.tsx';
import { SlideView } from '../ui/SlideView.tsx';
import { versionSlides, versionTime } from './songHistory.ts';

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
        <div className="px-7 text-neutral-400">{t('common.loading')}</div>
      </PageContainer>
    );

  const { versions, theme } = data;
  // The newest until one is chosen, and again if the chosen one is dropped (SONG-R21).
  const version = versions.find((v) => v.id === chosen) ?? versions[0];
  const shown = version && versionSlides(version);

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
        <div className="flex flex-col items-center justify-center py-16 text-neutral-400">
          <ClockIcon className="size-12 mb-3" />
          <span className="text-sm">{t('history.empty')}</span>
        </div>
      ) : (
        <div className="flex flex-col md:flex-row gap-4">
          <ul className="w-full md:w-72 shrink-0 space-y-1" aria-label={t('history.versions')}>
            {versions.map((v) => {
              const selected = v.id === version.id;
              return (
                <li key={v.id}>
                  <AppButton
                    variant="plain"
                    aria-pressed={selected}
                    onClick={() => setChosen(v.id)}
                    className={`w-full text-left px-3 h-[52px] flex flex-col justify-center rounded-lg cursor-pointer text-sm ${
                      selected ? 'bg-sky-500/15 dark:bg-sky-500/20 ring-1 ring-inset ring-sky-500/30' : 'bg-neutral-50 dark:bg-raised/50 hover:bg-raised-2'
                    }`}
                  >
                    <span className="truncate w-full dark:text-neutral-100">{v.name}</span>
                    <span className="text-xs text-neutral-400 truncate w-full">{versionTime(v.createdAt)}</span>
                  </AppButton>
                </li>
              );
            })}
          </ul>
          <section className="flex-1 min-w-0" aria-label={t('history.preview')}>
            <div className="flex items-start justify-between mb-2 px-1 gap-3">
              <div className="min-w-0">
                <div className="font-semibold text-sm dark:text-neutral-100 truncate">{shown!.name}</div>
                {shown!.author && <div className="text-xs text-neutral-400 truncate">{shown!.author}</div>}
                <div className="text-xs text-neutral-400 mt-0.5">{versionTime(version.createdAt)}</div>
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
      )}
    </PageContainer>
  );
}
