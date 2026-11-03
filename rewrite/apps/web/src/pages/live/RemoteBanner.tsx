import { t } from '../../i18n.ts';
import { RemoteIcon } from '../../ui/icons.tsx';

/**
 * The line at the top of a controller's page (Pages/Presentation.razor, remote mode): a soft amber capsule in the
 * middle rather than a strip across the page (Lars, 2026-11-03: less square).
 */
export function RemoteBanner() {
  return (
    <div className="shrink-0 flex justify-center px-3 py-1.5">
      <p className="flex items-center gap-1.5 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-300 px-3 py-1 text-[13px] font-medium">
        <RemoteIcon className="size-3.5 shrink-0" />
        {t('remote.banner')}
      </p>
    </div>
  );
}
