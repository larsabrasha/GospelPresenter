import { useEffect, useState, type ReactNode } from 'react';
import { api } from './auth/api.ts';
import { forgetSession, saveDeviceToken } from './auth/session.ts';
import { REPAIR_KEY } from './Boot.tsx';
import { useDbStatus } from './db/react.tsx';
import { t } from './i18n.ts';
import { AppButton } from './ui/AppButton.tsx';
import { WarningIcon } from './ui/icons.tsx';
import { isHostWindow } from './hostWindow.ts';

// What the signed-in app's frame shares (Layout/MainLayout.razor): signing out, the warnings under the bar, and the
// bar for an error nothing caught. The bar is TopBar.tsx; Inställningar's frame pages/settings/SettingsLayout.tsx.

/** Back to the sign-in screen. The local database stays (D3, DESK-A7). */
function toSignIn() {
  forgetSession();
  location.reload();
}

/**
 * Signs out: the server revokes the session (if it can be reached; offline,
 * the session is only forgotten here), and this device forgets it.
 */
export async function signOut() {
  await Promise.race([api('POST', '/api/auth/signout').catch(() => undefined), new Promise((r) => setTimeout(r, 3000))]);
  toSignIn();
}

function pairAgain() {
  saveDeviceToken(null);
  sessionStorage.setItem(REPAIR_KEY, '1');
  location.reload();
}

/**
 * What needs the user's attention (sign in again, pair again, data only in
 * memory), in a strip under the bar until it is dealt with. In the page's
 * flow, so it never covers a button.
 */
export function SyncWarnings() {
  const s = useDbStatus();
  const warnings: ReactNode[] = [];
  if (s && s.storage !== 'opfs' && !isHostWindow()) warnings.push(t('status.memory', { reason: s.storage }));
  if (s?.updateRequired) warnings.push(t('status.updateRequired'));
  if (s?.authError === 'device-not-paired')
    warnings.push(
      <>
        {t('status.notPaired')}
        <AppButton variant="secondary" className="ml-3 py-1.5!" onClick={pairAgain}>
          {t('status.pairAgain')}
        </AppButton>
      </>,
    );
  if (s?.authError === 'unauthenticated' || s?.authError === 'not-a-member')
    warnings.push(
      <>
        {t('status.authRequired')}
        <AppButton variant="secondary" className="ml-3 py-1.5!" onClick={toSignIn}>
          {t('status.signInAgain')}
        </AppButton>
      </>,
    );
  if (!warnings.length) return null;
  return (
    <div
      data-testid="sync-warnings"
      className="shrink-0 px-4 py-2 space-y-1 bg-amber-50 dark:bg-amber-950/40 border-b-[0.5px] border-amber-200 dark:border-amber-900 text-sm text-neutral-800 dark:text-neutral-100"
    >
      {warnings.map((w, i) => (
        <div key={i} className="flex items-center gap-2">
          <WarningIcon className="size-5 shrink-0 text-amber-500" />
          <div className="min-w-0 break-words">{w}</div>
        </div>
      ))}
    </div>
  );
}

/**
 * An error nothing caught: the current app's yellow bar at the bottom with Ladda
 * om (MainLayout.razor's blazor-error-ui). What went wrong is in the console.
 */
export function UnexpectedError() {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    // An ErrorEvent without an error is the browser's own notice, such as ResizeObserver's loop limit.
    const on = (e: Event) => {
      if (!(e instanceof ErrorEvent) || e.error) setFailed(true);
    };
    addEventListener('unhandledrejection', on);
    addEventListener('error', on);
    return () => {
      removeEventListener('unhandledrejection', on);
      removeEventListener('error', on);
    };
  }, []);
  if (!failed) return null;
  return (
    <div role="alert" className="fixed left-0 bottom-0 w-full z-[1000] p-3 bg-yellow-50 dark:bg-yellow-950 text-neutral-900 dark:text-neutral-100">
      {t('layout.unexpectedError')}
      <a href="." className="bg-green-500 text-white mx-3 px-3 py-2 rounded-xl no-underline">
        {t('layout.reload')}
      </a>
    </div>
  );
}
