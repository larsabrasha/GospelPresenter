import { useState } from 'react';
import { t } from '../../i18n.ts';
import { setRemoteAllowed } from '../../live/owner.ts';
import { remoteAllowed } from '../../live/remote.ts';
import { AppButton } from '../../ui/AppButton.tsx';
import { RemoteIcon } from '../../ui/icons.tsx';
import { href } from '../../ui/router.ts';
import { Sheet } from '../../ui/Sheet.tsx';
import { ToggleRow } from '../../ui/Toggle.tsx';
import { RemoteInfo } from './RemoteInfo.tsx';

/**
 * "Tillåt fjärrstyrning" and, beside it, the button for the link a phone opens
 * (spec 04 §1, §9), in a sheet of its own: no section to fold, the explanation under it. The first time it is
 * switched on here, the link's dialog opens by itself. Under the organisation's
 * "Alltid" there is no toggle: a line says so, and the link is always there.
 * The window's own toggle is kept meanwhile, for when the policy changes back.
 */
export function RemotePanel({ id, sessionId, name, always }: { id: string; sessionId: string; name: string | undefined; always: boolean }) {
  const [toggle, setToggle] = useState(remoteAllowed);
  const on = always || toggle;
  return (
    <div className="space-y-2">
      {always ? (
        <p className="flex items-center gap-2 text-sm text-stone-600 dark:text-stone-300">
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
          }}
        />
      )}
      {/* On, the QR code and the rest under the switch, in this sheet rather than a dialog over it (Lars, 2026-11-02). */}
      {on ? <RemoteInfo url={remoteUrl(id, sessionId)} name={name} /> : <p className="px-1 text-xs/4 text-stone-500 dark:text-stone-400">{t('live.remoteHint')}</p>}
    </div>
  );
}

/**
 * A quiet line at the foot of the live column on a computer, as the offline line at the foot of the left one: whether
 * remote control is on, and a click opens Fjärrstyrning's sheet with its switch (Lars, 2026-11-02).
 */
export function RemoteStatus({ id, sessionId, name, always }: { id: string; sessionId: string; name: string | undefined; always: boolean }) {
  const [open, setOpen] = useState(false);
  // Read anew as the sheet closes: the switch in it keeps the window's choice (live/owner.ts).
  const on = always || remoteAllowed();
  return (
    <>
      <AppButton
        variant="plain"
        onClick={() => setOpen(true)}
        data-testid="remote-status"
        data-state={on ? 'on' : 'off'}
        className="w-full flex items-center gap-2 px-2 py-1.5 touch:py-2.5 rounded-lg text-xs touch:text-[13px] text-left text-stone-500 dark:text-stone-400 hover:bg-raised cursor-pointer"
      >
        <RemoteIcon className={`size-4 shrink-0 ${on ? 'text-green-500' : ''}`} />
        {on ? t('remote.statusOn') : t('remote.statusOff')}
      </AppButton>
      {open && (
        <Sheet title={t('live.remote')} onClose={() => setOpen(false)}>
          <RemotePanel id={id} sessionId={sessionId} name={name} always={always} />
        </Sheet>
      )}
    </>
  );
}

function remoteUrl(id: string, sessionId: string): string {
  // The session is named in the link: a code taped to a lectern keeps meaning this machine.
  return href({ page: 'presentation', id, remote: true, session: sessionId });
}
