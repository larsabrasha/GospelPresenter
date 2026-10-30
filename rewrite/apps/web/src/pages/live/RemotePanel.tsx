import { useState } from 'react';
import { t } from '../../i18n.ts';
import { setRemoteAllowed } from '../../live/owner.ts';
import { remoteAllowed } from '../../live/remote.ts';
import { AppButton } from '../../ui/AppButton.tsx';
import { QrCodeOutlineIcon, RemoteIcon } from '../../ui/icons.tsx';
import { href } from '../../ui/router.ts';
import { ToggleRow } from '../../ui/Toggle.tsx';
import { PanelSection } from './PanelSection.tsx';
import { RemoteInfoDialog } from './RemoteInfoDialog.tsx';

/**
 * "Tillåt fjärrstyrning" and, beside it, the button for the link a phone opens
 * (spec 04 §1, §9); closed at first, as LivePanel.razor's. The first time it is
 * switched on here, the link's dialog opens by itself. Under the organisation's
 * "Alltid" there is no toggle: a line says so, and the link is always there.
 * The window's own toggle is kept meanwhile, for when the policy changes back.
 */
export function RemotePanel({ id, sessionId, name, always }: { id: string; sessionId: string; name: string | undefined; always: boolean }) {
  const [toggle, setToggle] = useState(remoteAllowed);
  const on = always || toggle;
  const [info, setInfo] = useState(false);
  const [autoShown, setAutoShown] = useState(false);
  return (
    <PanelSection title={t('live.remote')} hint={t('live.remoteHint')} open={false}>
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0">
          {always ? (
            <p className="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-300">
              <RemoteIcon className="size-4 shrink-0" />
              {t('remote.always')}
            </p>
          ) : (
            <ToggleRow
              label={t('remote.allow')}
              icon={<RemoteIcon className="size-4 shrink-0" />}
              checked={toggle}
              onChange={(v) => {
                setToggle(v);
                setRemoteAllowed(v);
                if (v && !autoShown) {
                  setAutoShown(true);
                  setInfo(true);
                }
              }}
            />
          )}
        </div>
        <AppButton
          variant="plain"
          disabled={!on}
          title={t('remote.showInfo')}
          aria-label={t('remote.showInfo')}
          onClick={() => setInfo(true)}
          className={`size-8 flex items-center justify-center rounded-lg shrink-0 transition-colors ${
            on
              ? 'cursor-pointer text-sky-600 dark:text-sky-400 bg-sky-100 dark:bg-sky-900/30 hover:bg-sky-200 dark:hover:bg-sky-900/50'
              : 'cursor-default text-neutral-400 dark:text-neutral-500 bg-neutral-100 dark:bg-neutral-700/50 opacity-50'
          }`}
        >
          <QrCodeOutlineIcon className="size-4" />
        </AppButton>
      </div>
      {info && <RemoteInfoDialog url={remoteUrl(id, sessionId)} name={name} onClose={() => setInfo(false)} />}
    </PanelSection>
  );
}

function remoteUrl(id: string, sessionId: string): string {
  // The session is named in the link: a code taped to a lectern keeps meaning this machine.
  return href({ page: 'presentation', id, remote: true, session: sessionId });
}
