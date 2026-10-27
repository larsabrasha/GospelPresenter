import { useState } from 'react';
import { useData, useDb, useDbStatus, usePresentationMedia } from '../db/react.tsx';
import { isPinned } from '../db/queries.ts';
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

/**
 * "Tillgänglig offline": keep every file of this presentation on this device,
 * whatever its date, so it can be worked with or presented without a
 * connection. Only where the data survives a reload; elsewhere it says why.
 */
export function KeepOffline({ presentationId }: { presentationId: string }) {
  const db = useDb();
  const status = useDbStatus();
  const saved = useData((r) => isPinned(r, presentationId), [presentationId]);
  // The click shows at once, until what the database says changes: then that is the truth.
  const [clicked, setClicked] = useState<{ value: boolean; over: boolean | undefined } | null>(null);
  const pinned = clicked && clicked.over === saved ? clicked.value : saved;
  const persistent = status?.storage === 'opfs';
  return (
    <div className="keep-offline">
      <label className="row">
        <input
          type="checkbox"
          checked={!!pinned && persistent}
          disabled={!persistent || pinned === undefined}
          onChange={(e) => {
            setClicked({ value: e.target.checked, over: saved });
            void db.setPinned(presentationId, e.target.checked);
          }}
        />
        {t('media.keepOffline')}
      </label>
      {status && !persistent && <p className="muted small">{t('media.keepOfflineUnavailable')}</p>}
    </div>
  );
}
