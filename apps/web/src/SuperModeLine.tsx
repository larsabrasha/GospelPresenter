import { useEffect, useState } from 'react';
import type { Me } from '@gp/core';
import { setSuperMode } from './auth/superMode.ts';
import { locale, t } from './i18n.ts';
import { createPortal } from 'react-dom';
import { AppButton } from './ui/AppButton.tsx';
import { useLayerRoot } from './ui/modal.tsx';

/**
 * The coloured line at the top while superadminläge is on (docs/accounts-and-roles.md), with when it ends and a button
 * to end it now, above any dialog. At its end it turns itself off here too, so the page shows what the server lets this session do.
 */
export function SuperModeLine({ me }: { me: Me }) {
  const layer = useLayerRoot();
  const until = me.role === 'superAdmin' ? me.superUntil : null;
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!until) return;
    const timer = setTimeout(() => void setSuperMode(false), Math.max(0, until - Date.now()));
    return () => clearTimeout(timer);
  }, [until]);
  if (!until) return null;
  const end = new Date(until).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
  const line = (shown: boolean, fixed: boolean) => (
    <div
      role={shown ? 'status' : undefined}
      aria-hidden={shown ? undefined : true}
      data-testid={shown ? 'super-mode' : undefined}
      className={`${fixed ? 'fixed top-0 inset-x-0' : 'relative'} ${shown ? '' : 'invisible'} z-[150] flex items-center justify-center gap-3 px-4 py-1 bg-violet-600 text-white text-xs font-medium shrink-0`}
    >
      <span className="truncate">{error ?? t('superMode.on', { time: end })}</span>
      <AppButton variant="plain" tabIndex={shown ? undefined : -1} className="shrink-0 rounded-full bg-white/20 hover:bg-white/30 px-3 py-0.5 cursor-pointer" onClick={() => void setSuperMode(false).then((e) => e && setError(e))}>
        {t('superMode.end')}
      </AppButton>
    </div>
  );
  // At hand from Inställningar too: while a modal is open, drawn in it at the window's top, over its dimmed page (all
  // outside a modal is inert, ui/modal.tsx); in the page a copy that is not seen keeps its room.
  if (layer && layer !== document.body)
    return (
      <>
        {line(false, false)}
        {createPortal(line(true, true), layer)}
      </>
    );
  return line(true, false);
}
