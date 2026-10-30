import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { LiveSessionInfo, Role } from '@gp/core';
import { t } from '../../i18n.ts';
import { RemoteAudio } from '../../live/audio.ts';
import { RemoteControl, useLiveSessions, type LiveLink } from '../../live/remote.ts';
import { AppButton } from '../../ui/AppButton.tsx';
import { useToast } from '../../ui/Toast.tsx';
import { PresentationEditor } from '../presentation-editor/PresentationEditor.tsx';
import { RemoteBanner } from './RemoteBanner.tsx';

/**
 * A controller (spec 04 §2): which session to drive, from the URL, the only
 * candidate, or a picker; then the same page, writing to that session. Its
 * own outputs and the remote toggle are the owner's, so they are not here.
 */
export function RemoteLive({ id, role, link, ownSessionId, wanted, stage }: { id: string; role: Role; link: LiveLink; ownSessionId: string; wanted: string | null; stage: boolean }) {
  const { sessions, connected } = useLiveSessions(link);
  const [picked, setPicked] = useState<string | null>(wanted);
  const candidates = sessions.filter((s) => s.presentationId === id && s.id !== ownSessionId);
  const chosen: LiveSessionInfo | undefined = candidates.find((s) => s.id === picked) ?? (candidates.length === 1 ? candidates[0] : undefined);
  // Why there is nothing to control (Presentation.razor): grey text, and what can still be done under it.
  const notReady = (text: string, extra?: ReactNode) => (
    <section className="flex-1 min-h-0 flex flex-col bg-neutral-100 dark:bg-neutral-900">
      <RemoteBanner />
      <div className="flex-1 flex items-center justify-center text-center px-6 py-16">
        <div className="space-y-2">
          <p className="text-neutral-400 dark:text-neutral-500 text-sm" data-testid="remote-state">
            {text}
          </p>
          {extra}
        </div>
      </div>
    </section>
  );
  if (!chosen && candidates.length > 1) {
    // Several sessions show it: one Primary button per session, the text above them not centred (Presentation.razor).
    return (
      <section className="flex-1 min-h-0 flex flex-col bg-neutral-100 dark:bg-neutral-900">
        <RemoteBanner />
        <div className="flex-1 flex items-center justify-center px-6 py-16">
          <div className="w-full max-w-sm space-y-3">
            <p className="text-sm text-neutral-500 dark:text-neutral-400" data-testid="remote-state">
              {t('remote.pick')}
            </p>
            {candidates.map((c, i) => (
              <AppButton key={c.id} variant="primary" filled onClick={() => setPicked(c.id)} className="w-full">
                {c.deviceName || t('remote.presentationN', { n: i + 1 })}
              </AppButton>
            ))}
          </div>
        </div>
      </section>
    );
  }
  if (!chosen) return notReady(connected ? t('remote.none') : t('remote.connecting'));
  // The owner gone comes before remote control off: nothing can switch it on again, and only ending it is left.
  if (!chosen.ownerOnline) {
    return notReady(
      t('remote.ownerOffline'),
      <div className="space-y-2 pt-2">
        <div className="text-neutral-400 dark:text-neutral-500 text-xs">{t('remote.endAbandonedHint')}</div>
        <AppButton variant="danger" filled onClick={() => link.end(chosen.id)}>
          {t('remote.endAbandoned')}
        </AppButton>
      </div>,
    );
  }
  if (!chosen.remote) return notReady(t('remote.off'));
  return <ControlledLive key={chosen.id} id={id} role={role} link={link} sessionId={chosen.id} stage={stage} />;
}

function ControlledLive({ id, role, link, sessionId, stage }: { id: string; role: Role; link: LiveLink; sessionId: string; stage: boolean }) {
  const toast = useToast();
  const control = useMemo(() => new RemoteControl(link, sessionId, () => toast(t('remote.unconfirmed'), 'warning')), [link, sessionId, toast]);
  const audio = useMemo(() => new RemoteAudio(link, sessionId), [link, sessionId]);
  useEffect(() => () => control.dispose(), [control]);
  return <PresentationEditor id={id} role={role} live={control} presenting={{ audio, owner: null, link }} stage={stage} />;
}
