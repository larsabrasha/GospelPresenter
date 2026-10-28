import { t } from '../../i18n.ts';

/** The strip at the top of a controller's page (Pages/Presentation.razor, remote mode). */
export function RemoteBanner() {
  return <p className="shrink-0 bg-amber-500 text-white text-center py-1.5 px-3 text-sm font-medium">{t('remote.banner')}</p>;
}
