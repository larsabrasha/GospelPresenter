import { t } from './i18n.ts';

// The commit the app was built from, written in by vite.config.ts: a release
// build's GP_COMMIT, or git's for the dev server; null when not known.
declare const GP_COMMIT: string | null | undefined;
const BUILT_COMMIT = typeof GP_COMMIT === 'string' ? GP_COMMIT : null;

/**
 * "Version abc1234" for the sign-in page and Mina inställningar (PLAT-R11): the commit, shortened to
 * seven characters, and "(utvecklingsbygge)" from the dev server. There is no
 * release number yet; null when the build knows no commit.
 */
export function appVersion(commit = BUILT_COMMIT, dev = import.meta.env.DEV): string | null {
  if (!commit) return null;
  return dev ? t('app.versionDev', { v: commit }) : t('app.version', { v: commit });
}
