import type { AudioControl } from '../../live/audio.ts';
import type { LiveControl, LiveLink } from '../../live/remote.ts';
import { LiveView } from './LiveView.tsx';
import { RemoteLive } from './RemoteLive.tsx';

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
  stage,
}: {
  id: string;
  live: LiveControl;
  link: LiveLink;
  audio: AudioControl;
  sessionId: string;
  remote?: boolean;
  session?: string | null;
  /** Opened in the stage view (`?stage=true`). */
  stage?: boolean;
}) {
  if (remote) return <RemoteLive id={id} link={link} ownSessionId={sessionId} wanted={session ?? null} stage={!!stage} />;
  return <LiveView id={id} live={live} audio={audio} owner={{ sessionId }} link={link} stage={!!stage} />;
}
