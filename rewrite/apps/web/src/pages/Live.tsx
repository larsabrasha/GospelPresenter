import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import type { LivePointer, LiveSessionInfo, Overlay, PresentationItem } from '@gp/core';
import { useData, useShownOverlay } from '../db/react.tsx';
import { listDisplays } from '../db/queries.ts';
import { useConfirm } from '../ui/Dialog.tsx';
import { viewersText } from './Displays.tsx';
import { getPresentation, itemsOf, listOverlays, themeOf } from '../db/queries.ts';
import { t } from '../i18n.ts';
import { RemoteAudio, useAudio, type AudioControl } from '../live/audio.ts';
import { slidesOf, type ItemSlides } from '../live/live.ts';
import { chosenOutputs, REMOTE_CHANGED, setOutput, setRemoteAllowed } from '../live/owner.ts';
import { remoteAllowed, RemoteControl, useLiveSessions, type LiveControl, type LiveLink } from '../live/remote.ts';
import { openOutput, useLivePointer } from '../live/useLive.ts';
import { AppButton } from '../ui/AppButton.tsx';
import { ArrowsPointingOutIcon, ChevronDownIcon, CloseIcon, DesktopIcon, FadeOutIcon, ItemIcon, PauseIcon, PlayIcon, PlusIcon, RemoteIcon, StopIcon } from '../ui/icons.tsx';
import { href, navigate } from '../ui/router.ts';
import { LiveBadge, tileClass } from '../ui/SlideTile.tsx';
import { CAPTION, ToggleRow, rowClass } from '../ui/Toggle.tsx';
import { MediaReadiness } from '../ui/MediaReadiness.tsx';
import { useToast } from '../ui/Toast.tsx';
import { SlideView } from '../ui/SlideView.tsx';
import { StageView } from './StageView.tsx';
import { OverlayToggles } from './OverlayToggles.tsx';
import { PairScreenDialog } from './PairScreen.tsx';
import { QrCode } from '../ui/QrCode.tsx';
import { useServerBase } from '../ui/serverBase.ts';

const problemText = { 'song-missing': t('live.songMissing'), 'song-trashed': t('live.songTrashed'), 'no-parts': t('live.noParts'), 'image-missing': t('live.imageMissing'), 'audio-missing': t('live.audioMissing') };

/**
 * The live page: this window presenting (the owner), or with `remote` a
 * phone or another computer driving a session elsewhere (spec 04 §2).
 */
export function Live({
  id,
  live,
  link,
  audio,
  sessionId,
  remote,
  session,
}: {
  id: string;
  live: LiveControl;
  link: LiveLink;
  audio: AudioControl;
  sessionId: string;
  remote?: boolean;
  session?: string | null;
}) {
  if (remote) return <RemoteLive id={id} link={link} ownSessionId={sessionId} wanted={session ?? null} />;
  return <LiveView id={id} live={live} audio={audio} owner={{ sessionId }} link={link} />;
}

/**
 * A section of the live panel (LivePanel.razor): its caption opens and closes
 * it, with the chevron, and the round "i" beside it shows what the section is
 * for. Closed, its content is inert, so neither Tab nor a screen reader finds it.
 */
function PanelSection({ title, hint, open: initiallyOpen, badge, children }: { title: string; hint: string; open: boolean; badge?: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(initiallyOpen);
  const [info, setInfo] = useState(false);
  const id = useId();
  return (
    <section>
      <div className="flex items-center gap-2">
        <h2 className="flex-1 min-w-0">
          <AppButton variant="plain" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)} className="cursor-pointer flex items-center gap-2 w-full text-left py-2 -my-2">
            <ChevronDownIcon className={`size-3 text-neutral-400 dark:text-neutral-500 transition-transform duration-300 ${open ? '' : '-rotate-90'}`} />
            <span className={CAPTION}>{title}</span>
            {badge}
          </AppButton>
        </h2>
        <AppButton
          variant="plain"
          aria-pressed={info}
          aria-label={t('live.hint', { title })}
          title={hint}
          onClick={() => setInfo((v) => !v)}
          className={`size-4 shrink-0 flex items-center justify-center rounded-full text-[10px] font-semibold border cursor-pointer transition-colors ${
            info ? 'bg-sky-500 border-sky-500 text-white' : 'border-neutral-300 dark:border-neutral-500 text-neutral-400 dark:text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300'
          }`}
        >
          i
        </AppButton>
      </div>
      {info && <p className="mt-2 px-3 py-2 rounded-lg bg-neutral-100 dark:bg-neutral-700/50 text-neutral-600 dark:text-neutral-300 text-xs leading-relaxed">{hint}</p>}
      <div id={id} inert={!open} className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
        <div className="overflow-hidden min-h-0">
          <div className="flex flex-col gap-3 p-1 pt-3">{children}</div>
        </div>
      </div>
    </section>
  );
}

/** "Tillåt fjärrstyrning" and the link a phone opens, as text and as a QR code (spec 04 §1, §9); closed at first, as LivePanel.razor's. */
function RemotePanel({ id, sessionId }: { id: string; sessionId: string }) {
  const [on, setOn] = useState(remoteAllowed);
  const base = useServerBase();
  const url = `${base}${href({ page: 'live', id, remote: true, session: sessionId })}`;
  return (
    <PanelSection title={t('live.remote')} hint={t('live.remoteHint')} open={false}>
      <ToggleRow
        label={t('remote.allow')}
        icon={<RemoteIcon className="size-4 shrink-0" />}
        checked={on}
        onChange={(v) => {
          setOn(v);
          setRemoteAllowed(v);
        }}
      />
      {on && (
        <div className="px-3 py-3 rounded-lg bg-neutral-100 dark:bg-neutral-700/50 space-y-3">
          <p className="text-xs leading-relaxed text-neutral-600 dark:text-neutral-300">{t('remote.how')}</p>
          <div className="flex justify-center [&_.qr]:m-0 [&_.qr]:rounded-lg">
            <QrCode value={url} label={t('remote.qr')} size={160} />
          </div>
          <input
            className="w-full px-3 py-1.5 rounded-lg border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-700 text-xs text-neutral-600 dark:text-neutral-300 focus:outline-none focus:ring-2 focus:ring-sky-500"
            readOnly
            value={url}
            aria-label={t('remote.link')}
            onFocus={(e) => e.currentTarget.select()}
          />
        </div>
      )}
    </PanelSection>
  );
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/**
 * An audio item's player (spec 04 §1b): play and pause, the seek bar, the time
 * and Tona ut. It drives the session's audio, which plays on the presenting
 * computer only: on a controller this is a mirror that sends commands.
 */
export function AudioPlayer({ control, itemId, name }: { control: AudioControl; itemId: string; name: string }) {
  const state = useAudio(control);
  const mine = state?.itemId === itemId ? state : null;
  const playing = !!mine?.playing;
  return (
    <div className="w-full sm:max-w-lg bg-white dark:bg-neutral-800 rounded-xl p-4 shadow-sm" role="group" aria-label={name} data-testid="audio-player" data-playing={playing}>
      <div className="flex items-center justify-between gap-3 mb-3">
        <p className="text-sm font-medium truncate flex-1">{name}</p>
        <AppButton
          variant="plain"
          disabled={!playing || mine?.fading}
          onClick={() => control.command({ action: 'fade', itemId })}
          className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-full bg-neutral-100 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-300 cursor-pointer hover:bg-neutral-200 dark:hover:bg-neutral-600 transition shrink-0 disabled:opacity-50 disabled:cursor-default"
        >
          <FadeOutIcon className="size-4" />
          {t('audio.fade')}
        </AppButton>
      </div>
      <div className="flex items-center gap-3">
        <AppButton
          variant="plain"
          aria-label={playing ? t('audio.pause') : t('audio.play')}
          onClick={() => control.command({ action: playing ? 'pause' : 'play', itemId })}
          className="size-10 flex items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-700 cursor-pointer hover:bg-neutral-200 dark:hover:bg-neutral-600 transition shrink-0"
        >
          {playing ? <PauseIcon className="size-5" /> : <PlayIcon className="size-5" />}
        </AppButton>
        <input
          className="flex-1 min-w-0 h-1.5 p-0 border-0 accent-sky-500 cursor-pointer disabled:cursor-default"
          type="range"
          min={0}
          max={mine?.duration ?? 0}
          step={0.1}
          value={mine?.position ?? 0}
          disabled={!mine}
          aria-label={t('audio.seek')}
          onChange={(e) => control.command({ action: 'seek', itemId, position: Number(e.target.value) })}
        />
        <span className="text-xs text-neutral-500 dark:text-neutral-400 tabular-nums shrink-0" data-testid="audio-time">
          {clock(mine?.position ?? 0)} / {mine?.duration ? clock(mine.duration) : '–:––'}
        </span>
      </div>
    </div>
  );
}

/**
 * Utgångar (spec 04 §1): the outputs this window sends to. Public outputs,
 * each with how many watch; saved screens, which can be switched on only
 * while their page is open (LIVE-A21); and temporary screens paired from
 * here, with ✕ to let one go. Taking an output from another presentation
 * asks first (LIVE-R23).
 */
function OutputsPanel({ link, sessionId }: { link: LiveLink; sessionId: string }) {
  const displays = useData(listDisplays, []);
  const { sessions, online, screens } = useLiveSessions(link);
  const { dialog, ask } = useConfirm();
  const [chosen, setChosen] = useState(chosenOutputs);
  const [pairing, setPairing] = useState(false);
  useEffect(() => {
    const on = () => setChosen(chosenOutputs());
    addEventListener(REMOTE_CHANGED, on);
    return () => removeEventListener(REMOTE_CHANGED, on);
  }, []);
  const mine = sessions.find((s) => s.id === sessionId);
  const temporary = screens.filter((x) => chosen.includes(x.id));
  return (
    <PanelSection title={t('live.outputs')} hint={t('live.outputsHint')} open>
      {dialog}
      <AppButton variant="plain" onClick={openOutput} className={`${rowClass(false)} w-full hover:bg-neutral-200 dark:hover:bg-neutral-700`}>
        <span className="flex items-center gap-2">
          <DesktopIcon className="size-4 shrink-0" />
          {t('live.output')}
        </span>
      </AppButton>
      <ul className="flex flex-col gap-3" aria-label={t('live.outputs')}>
        {displays?.map((d) => {
          const elsewhere = sessions.find((s) => s.id !== sessionId && s.outputs.some((o) => o.id === d.id));
          const viewers = mine?.outputs.find((o) => o.id === d.id)?.viewers;
          const offline = d.kind === 'screen' && !online.includes(d.id);
          const sending = chosen.includes(d.id) && !elsewhere && !offline;
          const toggle = async (on: boolean) => {
            if (on && elsewhere) {
              const ok = await ask({
                title: t('live.takeOverTitle'),
                text: t('live.takeOverText', { output: d.name, presentation: elsewhere.presentationName }),
                confirm: t('live.takeOver'),
              });
              if (!ok) return;
              return setOutput(d.id, true, true);
            }
            setOutput(d.id, on);
          };
          return (
            <li key={d.id}>
              <ToggleRow
                label={d.name}
                checked={sending}
                disabled={offline}
                onChange={(v) => void toggle(v)}
                icon={<DesktopIcon className={`size-4 shrink-0 ${sending ? 'text-green-500' : 'text-neutral-400 dark:text-neutral-500'}`} />}
                sub={offline ? t('screens.offline') : elsewhere ? t('displays.sending', { name: elsewhere.presentationName }) : undefined}
                extra={
                  d.kind === 'public' &&
                  viewers !== undefined && <span className={`text-[11px] ${viewers > 0 ? 'text-green-600 dark:text-green-400' : 'text-neutral-400 dark:text-neutral-500'}`}>{viewersText(viewers)}</span>
                }
              />
            </li>
          );
        })}
        {temporary.map((x) => (
          <li key={x.id} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-sky-100 dark:bg-sky-900/30 ring-1 ring-sky-500" aria-label={t('screens.temporary', { n: x.n })}>
            <span className="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-300">
              <DesktopIcon className="size-4 shrink-0" />
              {t('screens.temporary', { n: x.n })}
            </span>
            <AppButton
              variant="plain"
              aria-label={t('screens.disconnect', { n: x.n })}
              title={t('screens.disconnect', { n: x.n })}
              onClick={() => setOutput(x.id, false)}
              className="cursor-pointer text-neutral-400 dark:text-neutral-500 hover:text-red-500 dark:hover:text-red-400"
            >
              <CloseIcon className="size-4" />
            </AppButton>
          </li>
        ))}
      </ul>
      <AppButton variant="secondary" onClick={() => setPairing(true)} className="self-start flex items-center gap-1.5">
        <PlusIcon className="size-4" />
        {t('pairScreen.title')}
      </AppButton>
      {pairing && <PairScreenDialog sessionId={sessionId} onClose={() => setPairing(false)} />}
    </PanelSection>
  );
}

/** Overlays on the live page (spec 04 §1): collapsed by default, with a dot while one is on; absent without overlays. */
function OverlaysPanel({ overlays, pointer, live }: { overlays: Overlay[]; pointer: LivePointer; live: LiveControl }) {
  if (!overlays.length) return null;
  return (
    <PanelSection
      title={t('overlays.title')}
      hint={t('live.overlaysHint')}
      open={false}
      badge={pointer.overlayId && <span className="size-2 rounded-full bg-sky-500" data-testid="overlay-on" />}
    >
      <OverlayToggles overlays={overlays} pointer={pointer} live={live} />
    </PanelSection>
  );
}

/**
 * A controller (spec 04 §2): which session to drive, from the URL, the only
 * candidate, or a picker; then the same page, writing to that session. Its
 * own outputs and the remote toggle are the owner's, so they are not here.
 */
function RemoteLive({ id, link, ownSessionId, wanted }: { id: string; link: LiveLink; ownSessionId: string; wanted: string | null }) {
  const { sessions, connected } = useLiveSessions(link);
  const [picked, setPicked] = useState<string | null>(wanted);
  const candidates = sessions.filter((s) => s.presentationId === id && s.id !== ownSessionId);
  const chosen: LiveSessionInfo | undefined = candidates.find((s) => s.id === picked) ?? (candidates.length === 1 ? candidates[0] : undefined);
  const notReady = (text: string, extra?: ReactNode) => (
    <section className="flex-1 min-h-0 flex flex-col bg-neutral-100 dark:bg-neutral-900">
      <RemoteBanner />
      <div className="flex-1 flex items-center justify-center text-center px-6 py-16">
        <div className="w-full max-w-sm space-y-3">
          <p className="text-sm text-neutral-500 dark:text-neutral-400" data-testid="remote-state">
            {text}
          </p>
          {extra}
        </div>
      </div>
    </section>
  );
  if (!chosen && candidates.length > 1) {
    return notReady(
      t('remote.pick'),
      <div className="space-y-3">
        {candidates.map((c, i) => (
          <AppButton key={c.id} onClick={() => setPicked(c.id)} className="w-full">
            {c.deviceName || t('remote.presentationN', { n: i + 1 })}
          </AppButton>
        ))}
      </div>,
    );
  }
  if (!chosen) return notReady(connected ? t('remote.none') : t('remote.connecting'));
  if (!chosen.remote) return notReady(t('remote.off'));
  if (!chosen.ownerOnline) {
    return notReady(
      t('remote.ownerOffline'),
      <AppButton variant="danger" filled onClick={() => link.end(chosen.id)}>
        {t('remote.endAbandoned')}
      </AppButton>,
    );
  }
  return <ControlledLive key={chosen.id} id={id} link={link} sessionId={chosen.id} />;
}

/** The strip at the top of a controller's page (Pages/Presentation.razor, remote mode). */
function RemoteBanner() {
  return <p className="shrink-0 bg-amber-500 text-white text-center py-1.5 px-3 text-sm font-medium">{t('remote.banner')}</p>;
}

function ControlledLive({ id, link, sessionId }: { id: string; link: LiveLink; sessionId: string }) {
  const toast = useToast();
  const control = useMemo(() => new RemoteControl(link, sessionId, () => toast(t('remote.unconfirmed'))), [link, sessionId, toast]);
  const audio = useMemo(() => new RemoteAudio(link, sessionId), [link, sessionId]);
  useEffect(() => () => control.dispose(), [control]);
  return <LiveView id={id} live={control} audio={audio} owner={null} link={link} />;
}

/** The operator's view of a running presentation (spec 04): the owner's own, or a controller's. */
function LiveView({ id, live, audio, owner, link }: { id: string; live: LiveControl; audio: AudioControl; owner: { sessionId: string } | null; link: LiveLink }) {
  const pointer = useLivePointer(live);
  const [stage, setStage] = useState(false);
  const data = useData(
    async (db) => {
      const items = await itemsOf(db, id);
      const slides = new Map<string, ItemSlides>();
      for (const item of items) slides.set(item.id, await slidesOf(db, item));
      const presentation = await getPresentation(db, id);
      return { presentation, theme: await themeOf(db, presentation), items, slides, overlays: await listOverlays(db) };
    },
    [id],
  );
  const overlay = useShownOverlay(pointer.overlayId);

  useEffect(() => {
    // Opening the page as the owner starts presenting; a controller drives what is already live.
    if (owner && live.pointer.presentationId !== id) live.set({ presentationId: id, itemId: null, partIndex: 0, black: false });
  }, [id, live, owner]);

  /** Every slide of the running order, in order: what next and previous step through. */
  const steps = useMemo(
    () => (data ? data.items.flatMap((item) => (data.slides.get(item.id)?.slides ?? []).map((_, partIndex) => ({ itemId: item.id, partIndex }))) : []),
    [data],
  );

  const step = useCallback(
    (delta: number) => {
      const at = steps.findIndex((s) => s.itemId === pointer.itemId && s.partIndex === pointer.partIndex);
      const next = steps[at === -1 ? (delta > 0 ? 0 : steps.length - 1) : at + delta];
      if (next) live.set({ ...next, black: false });
    },
    [steps, pointer.itemId, pointer.partIndex, live],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (stage) return; // the stage view has its own keys
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(e.key)) step(1);
      else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) step(-1);
      else if (e.key === 'b' || e.key === 'B') live.set({ black: true }); // only blanks, as Rensa; a slide shows again
      else return;
      e.preventDefault();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [step, live, stage]);

  if (!data) return null;
  const current = pointer.itemId ? data.slides.get(pointer.itemId)?.slides[pointer.partIndex] ?? null : null;

  const itemRow = (item: PresentationItem) => {
    const s = data.slides.get(item.id)!;
    const selected = item.id === pointer.itemId;
    const carried = item.overlayId ? data.overlays.find((o) => o.id === item.overlayId) : undefined;
    return (
      <li key={item.id} className="space-y-2">
        <h3 className={`flex items-center gap-2 px-2 text-sm/6 font-semibold ${selected ? 'text-neutral-900 dark:text-neutral-100' : 'text-neutral-500 dark:text-neutral-400'}`}>
          <span className={`size-2 shrink-0 rounded-full ${selected && !pointer.black ? 'bg-red-500 animate-pulse' : ''}`} />
          <ItemIcon type={item.type} className="size-4 shrink-0" />
          <span className="truncate">{item.title}</span>
          {carried && (
            <span className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-normal bg-sky-50 dark:bg-sky-900/30 text-sky-600 dark:text-sky-400" title={t('overlays.carried')}>
              {carried.title}
            </span>
          )}
        </h3>
        {s.problem && <p className="mx-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">{problemText[s.problem]}</p>}
        {s.audio && (
          <div className="px-1">
            <AudioPlayer control={audio} itemId={item.id} name={s.audio.fileName} />
          </div>
        )}
        {!!s.slides.length && (
          <div className="flex flex-wrap gap-3">
            {s.slides.map((slide, i) => {
              const shown = selected && i === pointer.partIndex;
              return (
                <AppButton
                  key={slide.key}
                  variant="plain"
                  aria-label={`${item.title} ${i + 1}`}
                  aria-pressed={shown}
                  className={`${tileClass({ selected: shown, live: !pointer.black })} w-full sm:w-[calc(50%-0.75rem)] lg:w-96 m-1 p-0`}
                  onClick={() => live.set({ itemId: item.id, partIndex: i, black: false })}
                >
                  <SlideView slide={slide} theme={data.theme} />
                  {shown && !pointer.black && <LiveBadge>{t('stage.live')}</LiveBadge>}
                </AppButton>
              );
            })}
          </div>
        )}
      </li>
    );
  };

  return (
    <section className="flex-1 min-h-0 flex flex-col">
      {stage && <StageView items={data.items} slides={data.slides} theme={data.theme} overlays={data.overlays} live={live} audio={audio} onLeave={() => setStage(false)} />}
      {!owner && <RemoteBanner />}
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-y-auto lg:overflow-hidden">
        <div className="flex-1 min-w-0 bg-neutral-100 dark:bg-neutral-900 lg:overflow-y-auto">
          <div className="px-5 pt-3 pb-1">
            <h1 className="text-xl/10 font-semibold truncate">{data.presentation?.name}</h1>
            {/* The presenting computer needs everything; a remote control never plays audio, so it fetches none. */}
            <MediaReadiness presentationId={id} audio={!!owner} />
          </div>
          <ol className="px-3 pt-3 pb-6 space-y-6">{data.items.map(itemRow)}</ol>
        </div>
        <aside className="w-full lg:w-72 shrink-0 bg-white dark:bg-neutral-800 lg:shadow-xl lg:overflow-y-auto">
          <div className="p-4 flex flex-col gap-3 lg:min-h-full">
            <h2 className={CAPTION}>{t('live.preview')}</h2>
            <div className="aspect-video rounded-lg overflow-hidden">
              <SlideView slide={pointer.black ? null : current} theme={data.theme} label={false} overlay={pointer.black ? null : overlay} />
            </div>
            {/* Rensa only blanks, and is gone while the screen is black: a slide brings the picture back (LivePanel.razor). */}
            <div className={`mx-1 ${pointer.black ? 'invisible pointer-events-none' : ''}`}>
              <AppButton variant="secondary" title={t('live.clear')} onClick={() => live.set({ black: true })} className="w-full flex items-center justify-center gap-1.5">
                <CloseIcon className="size-4" />
                <span>{t('live.clear')}</span>
              </AppButton>
            </div>
            {owner && (
              <div className="mt-3">
                <OutputsPanel link={link} sessionId={owner.sessionId} />
              </div>
            )}
            {!!data.overlays.length && (
              <div className="mt-3">
                <OverlaysPanel overlays={data.overlays} pointer={pointer} live={live} />
              </div>
            )}
            {owner && (
              <div className="mt-3">
                <RemotePanel id={id} sessionId={owner.sessionId} />
              </div>
            )}
            <AppButton variant="secondary" onClick={() => setStage(true)} className="mt-3 flex items-center justify-center gap-2">
              <ArrowsPointingOutIcon className="size-5" />
              <span className="font-medium">{t('live.stage')}</span>
            </AppButton>
            <div className="mt-auto pt-4">
              {owner ? (
                <AppButton
                  variant="plain"
                  onClick={() => {
                    live.set({ presentationId: null, itemId: null, partIndex: 0, black: false });
                    navigate({ page: 'presentation', id });
                  }}
                  className="w-full px-4 py-2.5 rounded-full flex items-center justify-center gap-2 shadow-lg cursor-pointer bg-red-500 text-white hover:bg-red-600"
                >
                  <StopIcon className="size-5" />
                  <span className="text-sm font-medium">{t('live.end')}</span>
                </AppButton>
              ) : (
                <p className="text-xs text-neutral-500 dark:text-neutral-400 text-center">{t('remote.onlyOwnerStops')}</p>
              )}
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}
