import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { LiveSessionInfo, Role } from '@gp/core';
import { t } from '../../i18n.ts';
import { RemoteAudio } from '../../live/audio.ts';
import { RemoteVideo } from '../../live/video.ts';
import { RemoteControl, useLiveSessions, type LiveLink } from '../../live/remote.ts';
import { BackToPresentations } from '../../TopBar.tsx';
import { AppButton } from '../../ui/AppButton.tsx';
import { useToast } from '../../ui/Toast.tsx';
import { PresentationEditor } from '../presentation-editor/PresentationEditor.tsx';
import { RemoteBanner } from './RemoteBanner.tsx';
import { holdNewBuild } from '../../newBuild.ts';
import { CloudOffIcon } from '../../ui/icons.tsx';

/**
 * A controller (spec 04 §2): which session to drive, from the URL, the only
 * candidate, or a picker; then the same page, writing to that session. Its
 * own outputs and the remote toggle are the owner's, so they are not here.
 */
export function RemoteLive({ id, role, link, ownSessionId, wanted }: { id: string; role: Role; link: LiveLink; ownSessionId: string; wanted: string | null }) {
  const { sessions, connected } = useLiveSessions(link);
  const [picked, setPicked] = useState<string | null>(wanted);
  const candidates = sessions.filter((s) => s.presentationId === id && s.id !== ownSessionId);
  const chosen: LiveSessionInfo | undefined = candidates.find((s) => s.id === picked) ?? (candidates.length === 1 ? candidates[0] : undefined);
  // Why there is nothing to control (Presentation.razor), as iOS's empty states (Lars, 2026-11-03: less text, not as
  // wide, one size): an icon where it helps, a short line, and what can still be done under it, in a readable column.
  const notReady = (text: string, extra?: ReactNode, icon?: ReactNode) => (
    <Waiting>
      <div className="flex-1 flex items-center justify-center text-center px-6 py-16">
        <div className="max-w-xs flex flex-col items-center gap-3">
          {icon}
          <p className="text-[17px] font-semibold text-stone-700 dark:text-stone-200 text-balance" data-testid="remote-state">
            {text}
          </p>
          {extra}
        </div>
      </div>
    </Waiting>
  );
  if (!chosen && candidates.length > 1) {
    // Several sessions show it: one Primary button per session, the text above them not centred (Presentation.razor).
    return (
      <Waiting>
        <div className="flex-1 flex items-center justify-center px-6 py-16">
          <div className="w-full max-w-sm space-y-3">
            <p className="text-sm text-stone-500 dark:text-stone-400" data-testid="remote-state">
              {t('remote.pick')}
            </p>
            {candidates.map((c, i) => (
              <AppButton key={c.id} variant="primary" filled onClick={() => setPicked(c.id)} className="w-full">
                {c.deviceName || t('remote.presentationN', { n: i + 1 })}
              </AppButton>
            ))}
          </div>
        </div>
      </Waiting>
    );
  }
  if (!chosen) return notReady(connected ? t('remote.none') : t('remote.connecting'));
  // The owner gone comes before remote control off: nothing can switch it on again, and only ending it is left.
  if (!chosen.ownerOnline) {
    return notReady(
      t('remote.ownerOffline'),
      <>
        <p className="-mt-1 text-[15px] text-stone-500 dark:text-stone-400 text-balance">{t('remote.endAbandonedHint')}</p>
        <AppButton variant="danger" filled onClick={() => link.end(chosen.id)} className="mt-2">
          {t('remote.endAbandoned')}
        </AppButton>
      </>,
      <CloudOffIcon className="size-12 text-stone-400 dark:text-stone-500" />,
    );
  }
  if (!chosen.remote) return notReady(t('remote.off'));
  return <ControlledLive key={chosen.id} id={id} role={role} link={link} sessionId={chosen.id} />;
}

/** Nothing to control yet: the presentation's bar is not there, so this page has its own way back. */
function Waiting({ children }: { children: ReactNode }) {
  return (
    <section className="flex-1 min-h-0 flex flex-col bg-ground">
      <nav data-window-bar className="flex items-center px-4 h-14 sm:h-13 shrink-0 sm:border-b-[0.5px] sm:border-separator bg-ground">
        <BackToPresentations />
      </nav>
      <RemoteBanner />
      {children}
    </section>
  );
}

function ControlledLive({ id, role, link, sessionId }: { id: string; role: Role; link: LiveLink; sessionId: string }) {
  const toast = useToast();
  const control = useMemo(() => new RemoteControl(link, sessionId, () => toast(t('remote.unconfirmed'), 'warning')), [link, sessionId, toast]);
  const audio = useMemo(() => new RemoteAudio(link, sessionId), [link, sessionId]);
  const video = useMemo(() => new RemoteVideo(link, sessionId), [link, sessionId]);
  useEffect(() => () => control.dispose(), [control]);
  useEffect(holdNewBuild, []); // a reload would drop the session this window drives
  return <PresentationEditor id={id} role={role} live={control} presenting={{ audio, video, owner: null, link }} />;
}
