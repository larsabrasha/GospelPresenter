import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { LiveSessionInfo, PresentationItem } from '@gp/core';
import { useData } from '../db/react.tsx';
import { listDisplays } from '../db/queries.ts';
import { useConfirm } from '../ui/Dialog.tsx';
import { viewersText } from './Displays.tsx';
import { getPresentation, itemsOf, themeOf } from '../db/queries.ts';
import { t } from '../i18n.ts';
import { RemoteAudio, useAudio, type AudioControl } from '../live/audio.ts';
import { slidesOf, type ItemSlides } from '../live/live.ts';
import { chosenOutputs, REMOTE_CHANGED, setOutput, setRemoteAllowed } from '../live/owner.ts';
import { remoteAllowed, RemoteControl, useLiveSessions, type LiveControl, type LiveLink } from '../live/remote.ts';
import { openOutput, useLivePointer } from '../live/useLive.ts';
import { Button } from '../ui/Button.tsx';
import { href, navigate } from '../ui/router.ts';
import { useToast } from '../ui/Toast.tsx';
import { SlideView } from '../ui/SlideView.tsx';
import { StageView } from './StageView.tsx';

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

/** "Tillåt fjärrstyrning" and the link a phone opens (spec 04 §1, §9). The QR code is not built. */
function RemotePanel({ id, sessionId }: { id: string; sessionId: string }) {
  const [on, setOn] = useState(remoteAllowed);
  const [base, setBase] = useState(location.origin);
  useEffect(() => {
    // On a desktop host, the address other devices reach it at.
    void window.gpDesktop?.lanUrls().then(([lan]) => lan && setBase(lan));
  }, []);
  const url = `${base}${href({ page: 'live', id, remote: true, session: sessionId })}`;
  return (
    <div className="card remote-panel">
      <label className="row">
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => {
            setOn(e.target.checked);
            setRemoteAllowed(e.target.checked);
          }}
        />
        {t('remote.allow')}
      </label>
      {on && (
        <>
          <p className="muted small">{t('remote.how')}</p>
          <input className="grow" readOnly value={url} aria-label={t('remote.link')} onFocus={(e) => e.currentTarget.select()} />
        </>
      )}
    </div>
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
    <div className="audio-player row" role="group" aria-label={name} data-testid="audio-player" data-playing={playing}>
      <Button aria-label={playing ? t('audio.pause') : t('audio.play')} onClick={() => control.command({ action: playing ? 'pause' : 'play', itemId })}>
        {playing ? '⏸' : '▶'}
      </Button>
      <input
        className="grow"
        type="range"
        min={0}
        max={mine?.duration ?? 0}
        step={0.1}
        value={mine?.position ?? 0}
        disabled={!mine}
        aria-label={t('audio.seek')}
        onChange={(e) => control.command({ action: 'seek', itemId, position: Number(e.target.value) })}
      />
      <span className="muted small" data-testid="audio-time">
        {clock(mine?.position ?? 0)} / {mine?.duration ? clock(mine.duration) : '–:––'}
      </span>
      <Button disabled={!playing || mine?.fading} onClick={() => control.command({ action: 'fade', itemId })}>
        {t('audio.fade')}
      </Button>
    </div>
  );
}

/**
 * Utgångar (spec 04 §1): the public outputs this window sends to, each with
 * how many watch, or which presentation sends to it now. Taking one from
 * another presentation asks first (LIVE-R23).
 */
function OutputsPanel({ link, sessionId }: { link: LiveLink; sessionId: string }) {
  const displays = useData(listDisplays, []);
  const { sessions } = useLiveSessions(link);
  const { dialog, ask } = useConfirm();
  const [chosen, setChosen] = useState(chosenOutputs);
  useEffect(() => {
    const on = () => setChosen(chosenOutputs());
    addEventListener(REMOTE_CHANGED, on);
    return () => removeEventListener(REMOTE_CHANGED, on);
  }, []);
  if (!displays?.length) return null;
  const mine = sessions.find((s) => s.id === sessionId);
  return (
    <div className="card live-outputs">
      {dialog}
      <h2>{t('live.outputs')}</h2>
      <ul className="list" aria-label={t('live.outputs')}>
        {displays.map((d) => {
          const elsewhere = sessions.find((s) => s.id !== sessionId && s.outputs.some((o) => o.id === d.id));
          const viewers = mine?.outputs.find((o) => o.id === d.id)?.viewers;
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
            <li key={d.id} className="row">
              <label className="row grow">
                <input type="checkbox" checked={chosen.includes(d.id) && !elsewhere} onChange={(e) => void toggle(e.target.checked)} />
                {d.name}
              </label>
              {viewers !== undefined && <span className={viewers > 0 ? 'ok small' : 'muted small'}>{viewersText(viewers)}</span>}
              {elsewhere && <span className="muted small">{t('displays.sending', { name: elsewhere.presentationName })}</span>}
            </li>
          );
        })}
      </ul>
    </div>
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
    <section className="live">
      <p className="remote-banner">{t('remote.banner')}</p>
      <p data-testid="remote-state">{text}</p>
      {extra}
    </section>
  );
  if (!chosen && candidates.length > 1) {
    return notReady(
      t('remote.pick'),
      <div className="row">
        {candidates.map((c, i) => (
          <Button key={c.id} onClick={() => setPicked(c.id)}>
            {c.deviceName || t('remote.presentationN', { n: i + 1 })}
          </Button>
        ))}
      </div>,
    );
  }
  if (!chosen) return notReady(connected ? t('remote.none') : t('remote.connecting'));
  if (!chosen.remote) return notReady(t('remote.off'));
  if (!chosen.ownerOnline) {
    return notReady(
      t('remote.ownerOffline'),
      <Button variant="danger" onClick={() => link.end(chosen.id)}>
        {t('remote.endAbandoned')}
      </Button>,
    );
  }
  return <ControlledLive key={chosen.id} id={id} link={link} sessionId={chosen.id} />;
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
      return { presentation, theme: await themeOf(db, presentation), items, slides };
    },
    [id],
  );

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
      else if (e.key === 'b' || e.key === 'B') live.set({ black: !live.pointer.black });
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
    return (
      <li key={item.id} className={selected ? 'live-item selected' : 'live-item'}>
        <h3>{item.title}</h3>
        {s.problem && <p className="warning">{problemText[s.problem]}</p>}
        {s.audio && <AudioPlayer control={audio} itemId={item.id} name={s.audio.fileName} />}
        <div className="thumbs">
          {s.slides.map((slide, i) => (
            <Button
              key={slide.key}
              aria-label={`${item.title} ${i + 1}`}
              aria-pressed={selected && i === pointer.partIndex}
              className={selected && i === pointer.partIndex ? 'thumb current' : 'thumb'}
              onClick={() => live.set({ itemId: item.id, partIndex: i, black: false })}
            >
              <SlideView slide={slide} theme={data.theme} />
            </Button>
          ))}
        </div>
      </li>
    );
  };

  return (
    <section className="live">
      {stage && <StageView items={data.items} slides={data.slides} theme={data.theme} live={live} audio={audio} onLeave={() => setStage(false)} />}
      {!owner && <p className="remote-banner">{t('remote.banner')}</p>}
      <div className="row">
        <h1 className="grow">{data.presentation?.name}</h1>
        {owner && <Button onClick={openOutput}>{t('live.output')}</Button>}
        <Button onClick={() => setStage(true)}>{t('live.stage')}</Button>
        <Button aria-pressed={pointer.black} variant={pointer.black ? 'primary' : 'normal'} onClick={() => live.set({ black: !pointer.black })}>
          {t('live.black')}
        </Button>
        {owner ? (
          <Button
            onClick={() => {
              live.set({ presentationId: null, itemId: null, partIndex: 0, black: false });
              navigate({ page: 'presentation', id });
            }}
          >
            {t('live.end')}
          </Button>
        ) : (
          <span className="muted small">{t('remote.onlyOwnerStops')}</span>
        )}
      </div>
      {owner && <OutputsPanel link={link} sessionId={owner.sessionId} />}
      {owner && <RemotePanel id={id} sessionId={owner.sessionId} />}
      <div className="live-layout">
        <ol className="live-items">{data.items.map(itemRow)}</ol>
        <aside className="live-preview">
          <h2>{t('live.preview')}</h2>
          <SlideView slide={pointer.black ? null : current} theme={data.theme} label={false} />
        </aside>
      </div>
    </section>
  );
}
