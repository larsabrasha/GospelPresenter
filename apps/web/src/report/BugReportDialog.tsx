import { useEffect, useState } from 'react';
import { BUG_REPORT_LIMITS, type Me } from '@gp/core';
import { api } from '../auth/api.ts';
import { useDbStatus } from '../db/react.tsx';
import { t } from '../i18n.ts';
import type { LiveChannel } from '../live/live.ts';
import { AppButton } from '../ui/AppButton.tsx';
import { useAppCommand } from '../ui/appKeys.ts';
import { Dialog, DialogButtons } from '../ui/Dialog.tsx';
import { Group, SwitchRow } from '../ui/Group.tsx';
import { PhotoIcon } from '../ui/icons.tsx';
import { reportState, type ReportState } from './reportState.ts';
import { note } from './trail.ts';
import { refreshUnread } from './unread.ts';

// "Rapportera fel" (docs/bug-reports.md; Lars, 2026-11-05): what happened in the user's words, the window as it showed
// (the desktop app takes it; elsewhere one may attach a screenshot), and the app's state and last steps, all shown
// before it is sent. As hovstaspelet's: short, one field, the picture to leave out, and a clear thanks.

/** A picture file as a JPEG at most 1600 points wide, small enough for the server; null if it is no picture. */
async function fitShot(file: File): Promise<string | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / bitmap.width);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    for (const q of [0.75, 0.55, 0.35]) {
      const url = canvas.toDataURL('image/jpeg', q);
      if (url.length <= BUG_REPORT_LIMITS.shot) return url;
    }
    return null;
  } catch {
    return null;
  }
}

/** The window as it shows now, from the desktop app; null elsewhere, or if it cannot. */
async function capture(): Promise<string | null> {
  const take = window.gpDesktop?.capturePage;
  if (!take) return null;
  // Two frames, so the menu the report was chosen in has closed.
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const shot = await take().catch(() => null);
  return shot && shot.length <= BUG_REPORT_LIMITS.shot ? shot : null;
}

function BugReportDialog({ me, state, shot: taken, onClose }: { me: Me; state: ReportState; shot: string | null; onClose: () => void }) {
  const [text, setText] = useState('');
  const [shot, setShot] = useState(taken);
  const [withShot, setWithShot] = useState(true);
  const [phase, setPhase] = useState<'write' | 'sending' | 'sent' | 'failed' | 'badPicture'>('write');
  const send = async () => {
    setPhase('sending');
    try {
      const r = await api('POST', '/api/reports', { text: text.trim(), shot: withShot ? shot : null, state });
      setPhase(r.error ? 'failed' : 'sent');
    } catch {
      setPhase('failed');
    }
  };
  if (phase === 'sent')
    return (
      <Dialog title={t('report.thanks')} onClose={onClose}>
        <p className="text-sm">{t('report.sent')}</p>
        <DialogButtons>
          <AppButton autoFocus onClick={onClose}>
            {t('report.done')}
          </AppButton>
        </DialogButtons>
      </Dialog>
    );
  // Everything sent, as the server gets it, apart from the picture shown above: who, then the state.
  const sent = { reporter: { name: me.name, email: me.email, organisation: me.orgName }, ...state };
  return (
    <Dialog title={t('report.title')} onClose={onClose} maxWidthClass="max-w-lg">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim() && phase !== 'sending') void send();
        }}
      >
        <p className="text-sm text-stone-600 dark:text-stone-300">{t('report.lead')}</p>
        <Group>
          <textarea
            aria-label={t('report.what')}
            placeholder={t('report.what')}
            maxLength={BUG_REPORT_LIMITS.text}
            rows={5}
            autoFocus
            className="block w-full min-w-0 resize-none bg-transparent px-4 py-3 text-sm outline-none placeholder:text-stone-400 dark:placeholder:text-stone-500"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </Group>
        {shot && (
          <Group>
            <img src={shot} alt={t('report.shotAlt')} className={`block w-full ${withShot ? '' : 'opacity-40'}`} data-testid="report-shot" />
            <SwitchRow title={t('report.withShot')} checked={withShot} onChange={setWithShot} />
          </Group>
        )}
        <AppButton asLabel variant="secondary" className="inline-flex items-center gap-1.5">
          <PhotoIcon className="size-4 shrink-0" />
          {shot ? t('report.otherShot') : t('report.addShot')}
          <input
            type="file"
            accept="image/*"
            hidden
            data-testid="report-file"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              void fitShot(file).then((url) => {
                if (!url) return setPhase('badPicture');
                setShot(url);
                setWithShot(true);
                setPhase('write');
              });
            }}
          />
        </AppButton>
        <details className="text-sm">
          <summary className="cursor-pointer text-sky-600 dark:text-sky-400">{t('report.showSent')}</summary>
          <p className="mt-2 text-stone-500 dark:text-stone-400">{t('report.never')}</p>
          <pre data-testid="report-sent" className="mt-2 max-h-64 overflow-auto rounded-lg bg-stone-100 dark:bg-raised/50 p-3 text-xs whitespace-pre-wrap break-all select-text">
            {JSON.stringify(sent, null, 2)}
          </pre>
        </details>
        {(phase === 'failed' || phase === 'badPicture') && (
          <p className="text-sm text-red-500 dark:text-red-400" role="alert">
            {phase === 'failed' ? t('report.failed') : t('report.badPicture')}
          </p>
        )}
        <DialogButtons>
          <AppButton variant="cancel" onClick={onClose}>
            {t('common.cancel')}
          </AppButton>
          <AppButton type="submit" disabled={!text.trim()} loading={phase === 'sending'}>
            {t('report.send')}
          </AppButton>
        </DialogButtons>
      </form>
    </Dialog>
  );
}

/**
 * Opens the report on the `report` command (the profile menu, the desktop app's Hjälp menu), with the window as it
 * showed and the state at that moment, not as they are when it is sent. Notes what goes live in the trail.
 */
export function BugReportHost({ me, live }: { me: Me; live: LiveChannel }) {
  const status = useDbStatus();
  const [open, setOpen] = useState<{ state: ReportState; shot: string | null } | null>(null);
  useAppCommand('report', () => {
    if (open) return;
    const state = reportState(me, status, live.pointer);
    void capture().then((shot) => setOpen({ state, shot }));
  });
  // Answers to the user's reports: asked for at the start and whenever the app comes back into view (unread.ts).
  useEffect(() => {
    void refreshUnread();
    const onVisible = () => document.visibilityState === 'visible' && void refreshUnread();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);
  useEffect(() => {
    let last = '';
    return live.subscribe((p) => {
      const now = !p.presentationId ? 'stopped' : p.black ? 'black' : `${p.presentationId.slice(0, 8)}/${(p.itemId ?? '-').slice(0, 8)} #${p.partIndex + 1}${p.overlayId ? ' +overlay' : ''}`;
      if (now !== last && (last || now !== 'stopped')) note('live', now);
      last = now;
    });
  }, [live]);
  return open && <BugReportDialog me={me} state={open.state} shot={open.shot} onClose={() => setOpen(null)} />;
}
