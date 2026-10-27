import { useDbStatus, usePresentationMedia } from '../db/react.tsx';
import { t } from '../i18n.ts';

/**
 * Whether the pictures and audio a presentation needs are on this device
 * (README, "Which files a device keeps"). While it is open they are fetched;
 * offline, what is missing cannot be, and that is said before going live.
 */
export function MediaReadiness({ presentationId, audio }: { presentationId: string; audio: boolean }) {
  const state = usePresentationMedia(presentationId, audio);
  const status = useDbStatus();
  if (!state || state.needed === 0) return null;
  const missing = state.needed - state.present;
  if (!missing) {
    return (
      <p className="ok small" data-testid="media-ready">
        {t('media.ready')}
      </p>
    );
  }
  return (
    <p className={status?.connected === false ? 'warning small' : 'muted small'} data-testid="media-ready">
      {status?.connected === false ? t('media.missingOffline', { n: missing }) : t('media.fetching', { present: state.present, needed: state.needed })}
    </p>
  );
}
