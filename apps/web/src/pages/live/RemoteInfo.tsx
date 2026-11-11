import { t } from '../../i18n.ts';
import { AppButton } from '../../ui/AppButton.tsx';
import { CheckIcon, LinkIcon } from '../../ui/icons.tsx';
import { QrCode } from '../../ui/QrCode.tsx';
import { useServerBase } from '../../ui/serverBase.ts';
import { useCopied } from '../../ui/copyText.ts';

// How a phone takes control, in Fjärrstyrning's sheet (Lars, 2026-11-03: as Apple would, few words): Kopiera länk as
// a row of the switch's group, and the link as a QR code under the group. Off, both keep their place, the code's
// empty and faded and the row doing nothing, so the sheet keeps its size as the switch turns.

/** The link a phone opens, with the server's address. */
export function useRemoteLink(path: string): string {
  return `${useServerBase()}${path}`;
}

/**
 * Kopiera länk, a row of the group as Visning's Anslut tillfällig utgång. Copied, the row itself says so for two
 * seconds, as a web page's copy button does, rather than a toast the sheet may hide (Lars, 2026-11-03); over plain
 * http on the LAN too (copyText.ts).
 */
export function CopyLinkRow({ url, on }: { url: string; on: boolean }) {
  const [copied, copy] = useCopied();
  return (
    <AppButton
      variant="plain"
      disabled={!on}
      onClick={() => copy(url)}
      className="w-full flex items-center gap-3.5 text-left cursor-pointer min-h-12 px-4 text-[17px] text-sky-600 dark:text-sky-400 hover:bg-black/5 dark:hover:bg-white/5 disabled:text-stone-400 dark:disabled:text-stone-500 disabled:cursor-default disabled:hover:bg-transparent"
    >
      {copied ? <CheckIcon className="size-5 shrink-0" /> : <LinkIcon className="size-5 shrink-0" />}
      <span aria-live="polite">{t(copied ? 'displays.copied' : 'remote.copyLink')}</span>
    </AppButton>
  );
}

/** The link as a QR code, with one line under it. */
export function RemoteQr({ url, on }: { url: string; on: boolean }) {
  return (
    <section aria-label={t('remote.infoTitle')} className={`space-y-2 transition-opacity duration-200 ${on ? '' : 'opacity-40'}`}>
      <div className="flex justify-center">
        <div className={`${on ? 'bg-white' : 'bg-stone-200 dark:bg-raised'} p-3 rounded-lg w-48 h-48 flex items-center justify-center [&>svg]:w-full [&>svg]:h-full [&_.qr]:m-0`}>
          {on && <QrCode value={url} label={t('remote.qr')} />}
        </div>
      </div>
      <p className="text-sm text-stone-500 dark:text-stone-400 text-center">{t('remote.scanHint')}</p>
    </section>
  );
}
