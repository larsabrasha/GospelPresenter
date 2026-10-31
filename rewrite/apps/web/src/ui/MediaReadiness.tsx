import { useDbStatus, usePresentationMedia } from '../db/react.tsx';
import { t } from '../i18n.ts';

/**
 * Whether the pictures and audio a presentation needs are on this device
 * (docs/media-and-files.md, "Which files a device keeps"), while this window presents it (Starta
 * presentation fetched them) or keeps it offline; offline, what is missing cannot be, and that is said.
 */
export function MediaReadiness({ presentationId, audio }: { presentationId: string; audio: boolean }) {
  const state = usePresentationMedia(presentationId, audio);
  const status = useDbStatus();
  if (!state || state.needed === 0) return null;
  const missing = state.needed - state.present;
  // All there is the usual case: said to screen readers only, so the eye meets a line only when something is missing.
  if (!missing) {
    return (
      <p className="sr-only" data-testid="media-ready">
        {t('media.ready')}
      </p>
    );
  }
  // Fetched quietly (TODO.md: presenting fetches its files at once, quietly): only what cannot be fetched is said aloud.
  if (status?.connected !== false) {
    return (
      <p className="sr-only" data-testid="media-ready">
        {t('media.fetching', { present: state.present, needed: state.needed })}
      </p>
    );
  }
  return (
    <p className="text-xs text-amber-600 dark:text-amber-400" data-testid="media-ready">
      {t('media.missingOffline', { n: missing })}
    </p>
  );
}
