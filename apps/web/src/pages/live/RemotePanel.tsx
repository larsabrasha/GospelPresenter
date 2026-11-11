import { useState } from 'react';
import { t } from '../../i18n.ts';
import { setRemoteAllowed } from '../../live/owner.ts';
import { remoteAllowed } from '../../live/remote.ts';
import { AppButton } from '../../ui/AppButton.tsx';
import { RemoteIcon } from '../../ui/icons.tsx';
import { href } from '../../ui/router.ts';
import { Sheet } from '../../ui/Sheet.tsx';
import { ToggleRow } from '../../ui/Toggle.tsx';
import { PanelGroup } from './PanelGroup.tsx';
import { CopyLinkRow, RemoteQr, useRemoteLink } from './RemoteInfo.tsx';

/**
 * "Tillåt fjärrstyrning" (spec 04 §1, §9) in a sheet of its own, as one group as Visning's (Lars, 2026-11-03): the
 * switch with what it is for under its name, and Kopiera länk under it; the QR code under the group. Under the
 * organisation's "Alltid" there is no switch: the row says so, and the link is always there. The window's own choice
 * is kept meanwhile, for when the policy changes back.
 */
function RemotePanel({ id, sessionId, always }: { id: string; sessionId: string; always: boolean }) {
  const [toggle, setToggle] = useState(remoteAllowed);
  const on = always || toggle;
  const url = useRemoteLink(remoteUrl(id, sessionId));
  return (
    <div className="space-y-5">
      <PanelGroup sheet>
        {always ? (
          <p className="flex items-center gap-3.5 min-h-12 px-4 py-2.5 text-[15px] text-stone-600 dark:text-stone-300">
            <RemoteIcon className="size-5 shrink-0 text-green-500" />
            {t('remote.always')}
          </p>
        ) : (
          <ToggleRow
            cell
            label={t('remote.allow')}
            checked={toggle}
            icon={<RemoteIcon className={`size-4 shrink-0 ${toggle ? 'text-green-500' : 'text-stone-500 dark:text-stone-400'}`} />}
            sub={t('live.remoteHint')}
            onChange={(v) => {
              setToggle(v);
              setRemoteAllowed(v);
            }}
          />
        )}
        <CopyLinkRow url={url} on={on} />
      </PanelGroup>
      <RemoteQr url={url} on={on} />
    </div>
  );
}

/**
 * A quiet line at the foot of the live column on a computer, as the offline line at the foot of the left one: whether
 * remote control is on, and a click opens Fjärrstyrning's sheet with its switch (Lars, 2026-11-02).
 */
export function RemoteStatus({ id, sessionId, always, className = 'w-full' }: { id: string; sessionId: string; always: boolean; className?: string }) {
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
        className={`${className} flex items-center gap-2 px-2 py-1.5 touch:py-2.5 rounded-lg text-xs touch:text-[13px] text-left text-stone-500 dark:text-stone-400 hover:bg-stone-200/60 dark:hover:bg-white/[0.06] cursor-pointer`}
      >
        <RemoteIcon className={`size-4 shrink-0 ${on ? 'text-green-500' : ''}`} />
        {on ? t('remote.statusOn') : t('remote.statusOff')}
      </AppButton>
      {open && (
        <Sheet title={t('live.remote')} onClose={() => setOpen(false)}>
          <RemotePanel id={id} sessionId={sessionId} always={always} />
        </Sheet>
      )}
    </>
  );
}

function remoteUrl(id: string, sessionId: string): string {
  // The session is named in the link: a code taped to a lectern keeps meaning this machine.
  return href({ page: 'presentation', id, remote: true, session: sessionId });
}
