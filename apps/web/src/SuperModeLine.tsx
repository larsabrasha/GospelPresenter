import { useEffect, useState } from 'react';
import type { Me } from '@gp/core';
import { setSuperMode } from './auth/superMode.ts';
import { locale, t } from './i18n.ts';
import { AppButton } from './ui/AppButton.tsx';

/**
 * The coloured line at the top while superadminläge is on (docs/accounts-and-roles.md), with when it ends and a button
 * to end it now, above any dialog. At its end it turns itself off here too, so the page shows what the server lets this session do.
 */
export function SuperModeLine({ me }: { me: Me }) {
  const until = me.role === 'superAdmin' ? me.superUntil : null;
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!until) return;
    const timer = setTimeout(() => void setSuperMode(false), Math.max(0, until - Date.now()));
    return () => clearTimeout(timer);
  }, [until]);
  if (!until) return null;
  const end = new Date(until).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
  return (
    // Above every dialog's dimmed backdrop (z-[140]), so Avsluta is at hand from Inställningar too.
    <div role="status" data-testid="super-mode" className="relative z-[150] flex items-center justify-center gap-3 px-4 py-1 bg-violet-600 text-white text-xs font-medium shrink-0">
      <span className="truncate">{error ?? t('superMode.on', { time: end })}</span>
      <AppButton variant="plain" className="shrink-0 rounded-full bg-white/20 hover:bg-white/30 px-3 py-0.5 cursor-pointer" onClick={() => void setSuperMode(false).then((e) => e && setError(e))}>
        {t('superMode.end')}
      </AppButton>
    </div>
  );
}
