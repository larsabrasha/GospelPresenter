import type { Role } from '@gp/core';
import type { AudioControl } from '../../live/audio.ts';
import type { VideoControl } from '../../live/video.ts';
import type { LiveControl, LiveLink } from '../../live/remote.ts';
import { useLivePointer } from '../../live/useLive.ts';
import { PresentationEditor } from '../presentation-editor/PresentationEditor.tsx';
import { RemoteLive } from './RemoteLive.tsx';

/**
 * A presentation's page (`/presentations/{id}`), as Presentation.razor: its editor, presenting while
 * this window's session shows it; or with `remote` a phone or another computer driving a session
 * elsewhere (spec 04 §2).
 */
export function Live({
  id,
  role,
  live,
  link,
  audio,
  video,
  sessionId,
  remote,
  session,
  stage,
}: {
  id: string;
  role: Role;
  live: LiveControl;
  link: LiveLink;
  audio: AudioControl;
  video: VideoControl;
  sessionId: string;
  remote?: boolean;
  session?: string | null;
  /** Opened in the stage view (`?stage=true`). */
  stage?: boolean;
}) {
  const pointer = useLivePointer(live);
  if (remote) return <RemoteLive id={id} role={role} link={link} ownSessionId={sessionId} wanted={session ?? null} stage={!!stage} />;
  const presenting = pointer.presentationId === id ? { audio, video, owner: { sessionId }, link } : undefined;
  return <PresentationEditor id={id} role={role} live={live} presenting={presenting} stage={stage} />;
}
