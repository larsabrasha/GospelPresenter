import { useId, useState, type ReactNode } from 'react';
import { t } from '../../i18n.ts';
import { AppButton } from '../../ui/AppButton.tsx';
import { CopyField } from '../../ui/CopyField.tsx';
import { ChevronDownIcon } from '../../ui/icons.tsx';
import { QrCode } from '../../ui/QrCode.tsx';
import { useServerBase } from '../../ui/serverBase.ts';
import { useToast } from '../../ui/Toast.tsx';
import { CAPTION } from '../../ui/Toggle.tsx';
import { copyLink } from '../Displays.tsx';

/** A caption that opens and closes what is under it (RemoteControlInfoDialog.razor); closed, its content is inert. */
function Fold({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div>
      <AppButton variant="plain" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)} className="cursor-pointer flex items-center gap-2 w-full text-left py-2 -my-2">
        <ChevronDownIcon className={`size-3 text-stone-400 dark:text-stone-500 transition-transform duration-300 ${open ? '' : '-rotate-90'}`} />
        <span className={CAPTION}>{title}</span>
      </AppButton>
      <div id={id} inert={!open} className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
        <div className="overflow-hidden min-h-0">{children}</div>
      </div>
    </div>
  );
}

/**
 * How a phone takes control (RemoteControlInfoDialog.razor), under Fjärrstyrning's switch while it is on: the link as
 * a QR code, then, folded, the link to copy and how to take control from the app.
 */
export function RemoteInfo({ url: path, name }: { url: string; name: string | undefined }) {
  const toast = useToast();
  const url = `${useServerBase()}${path}`;
  return (
    <section aria-label={t('remote.infoTitle')} className="space-y-4 pt-2">
      <div className="space-y-2">
        <div className="flex justify-center">
          <div className="bg-white p-3 rounded-lg w-48 h-48 flex items-center justify-center [&>svg]:w-full [&>svg]:h-full [&_.qr]:m-0">
            <QrCode value={url} label={t('remote.qr')} />
          </div>
        </div>
        <p className="text-sm text-stone-500 dark:text-stone-400 text-center">{t('remote.scanHint')}</p>
      </div>
      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-stone-200 dark:bg-raised" />
        <span className="text-xs uppercase tracking-widest text-stone-400 dark:text-stone-500">{t('remote.or')}</span>
        <div className="h-px flex-1 bg-stone-200 dark:bg-raised" />
      </div>
      <Fold title={t('remote.copyLink')}>
        <div className="pt-3">
          <CopyField value={url} label={t('remote.link')} copyLabel={t('displays.copy')} onCopy={() => void copyLink(url, () => toast(t('displays.copied')))} />
        </div>
      </Fold>
      <Fold title={t('remote.openAppTitle')}>
        <div className="pt-3 space-y-2">
          <p className="text-sm text-stone-500 dark:text-stone-400">{t('remote.openAppHint')}</p>
          {/* A small picture of the other app's start page, with its "Ta kontroll" card. */}
          <div className="rounded-lg border border-separator overflow-hidden bg-white dark:bg-ground shadow-sm pointer-events-none select-none" aria-hidden="true">
            <div className="flex items-center gap-1 px-2 py-1.5 bg-stone-100 dark:bg-surface border-b border-separator">
              <span className="size-1.5 rounded-full bg-red-400" />
              <span className="size-1.5 rounded-full bg-yellow-400" />
              <span className="size-1.5 rounded-full bg-green-400" />
            </div>
            <div className="p-2">
              <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded border border-emerald-200 dark:border-emerald-800">
                <div className="px-2 py-1.5 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="inline-block size-1.5 rounded-full bg-emerald-500 shrink-0 animate-pulse" />
                    <div className="min-w-0">
                      <div className="text-[8px] font-semibold uppercase tracking-widest text-emerald-600 dark:text-emerald-400">{t('remote.nowShowing')}</div>
                      <div className="text-[10px] font-medium text-stone-700 dark:text-stone-200 truncate">{name ?? t('remote.activePresentation')}</div>
                    </div>
                  </div>
                  <div className="shrink-0 px-1.5 py-0.5 rounded bg-emerald-500 text-white text-[9px] font-medium">{t('remote.takeControl')}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Fold>
    </section>
  );
}
