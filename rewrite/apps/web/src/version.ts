import { t } from './i18n.ts';

// The commit the app was built from, written in by vite.config.ts; null when
// there was no git to ask.
declare const GP_COMMIT: string | null | undefined;

/**
 * "Version abc1234" for the sign-in page and Mina inställningar (PLAT-R11): the commit, shortened to
 * seven characters, and "(utvecklingsbygge)" from the dev server. There is no
 * release number yet; null when the build knows no commit.
 */
export function appVersion(): string | null {
  const commit = typeof GP_COMMIT === 'string' ? GP_COMMIT : null;
  if (!commit) return null;
  return import.meta.env.DEV ? t('app.versionDev', { v: commit }) : t('app.version', { v: commit });
}
