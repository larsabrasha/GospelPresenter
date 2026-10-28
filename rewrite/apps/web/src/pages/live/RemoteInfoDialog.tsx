import { useId, useState, type ReactNode } from 'react';
import { t } from '../../i18n.ts';
import { AppButton } from '../../ui/AppButton.tsx';
import { CopyField } from '../../ui/CopyField.tsx';
import { Dialog } from '../../ui/Dialog.tsx';
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
        <ChevronDownIcon className={`size-3 text-neutral-400 dark:text-neutral-500 transition-transform duration-300 ${open ? '' : '-rotate-90'}`} />
        <span className={CAPTION}>{title}</span>
      </AppButton>
      <div id={id} inert={!open} className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
        <div className="overflow-hidden min-h-0">{children}</div>
      </div>
    </div>
  );
}

/**
 * "Fjärrstyr presentationen" (RemoteControlInfoDialog.razor): the link as a QR
 * code, then, folded, the link to copy and how to take control from the app.
 */
export function RemoteInfoDialog({ url: path, name, onClose }: { url: string; name: string | undefined; onClose: () => void }) {
  const toast = useToast();
  const url = `${useServerBase()}${path}`;
  return (
    <Dialog title={t('remote.infoTitle')} onClose={onClose} maxWidthClass="max-w-sm" showClose>
      <div className="space-y-2">
        <div className="flex justify-center">
          <div className="bg-white p-3 rounded-lg w-48 h-48 flex items-center justify-center [&>svg]:w-full [&>svg]:h-full [&_.qr]:m-0">
            <QrCode value={url} label={t('remote.qr')} />
          </div>
        </div>
        <p className="text-sm text-neutral-500 dark:text-neutral-400 text-center">{t('remote.scanHint')}</p>
      </div>
      <div className="mt-8! flex items-center gap-3">
        <div className="h-px flex-1 bg-neutral-200 dark:bg-neutral-700" />
        <span className="text-xs uppercase tracking-widest text-neutral-400 dark:text-neutral-500">{t('remote.or')}</span>
        <div className="h-px flex-1 bg-neutral-200 dark:bg-neutral-700" />
      </div>
      <Fold title={t('remote.copyLink')}>
        <div className="pt-3">
          <CopyField value={url} label={t('remote.link')} copyLabel={t('displays.copy')} onCopy={() => void copyLink(url, () => toast(t('displays.copied')))} />
        </div>
      </Fold>
      <Fold title={t('remote.openAppTitle')}>
        <div className="pt-3 space-y-2">
          <p className="text-sm text-neutral-500 dark:text-neutral-400">{t('remote.openAppHint')}</p>
          {/* A small picture of the other app's start page, with its "Ta kontroll" card. */}
          <div className="rounded-lg border border-neutral-200 dark:border-neutral-700 overflow-hidden bg-white dark:bg-neutral-900 shadow-sm pointer-events-none select-none" aria-hidden="true">
            <div className="flex items-center gap-1 px-2 py-1.5 bg-neutral-100 dark:bg-neutral-800 border-b border-neutral-200 dark:border-neutral-700">
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
                      <div className="text-[10px] font-medium text-neutral-700 dark:text-neutral-200 truncate">{name ?? t('remote.activePresentation')}</div>
                    </div>
                  </div>
                  <div className="shrink-0 px-1.5 py-0.5 rounded bg-emerald-500 text-white text-[9px] font-medium">{t('remote.takeControl')}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Fold>
    </Dialog>
  );
}
