import { useState } from 'react';
import { can, listThemes, type Role, type Slide } from '@gp/core';
import { useData, useDb } from '../db/react.tsx';
import { orgDefaultThemeId } from '../db/queries.ts';
import { t } from '../i18n.ts';
import { Button } from '../ui/Button.tsx';
import { SlideView } from '../ui/SlideView.tsx';
import { useToast } from '../ui/Toast.tsx';

/** The sample every card shows, as spec 05 has it. */
const SAMPLE: Slide = {
  key: 'sample',
  kind: 'song',
  text: 'Amazing grace\nhow sweet the sound',
  verses: null,
  image: null,
  label: null,
  credits: 'John Newton · 1779',
};

/**
 * Teman (spec 05 `/admin/themes`): the built-in themes with a preview, and
 * the organisation's default. Everyone sees it; admins set the default.
 * Themes are not created or edited yet (ADR 0001: the editor comes later).
 */
export function Themes({ role }: { role: Role }) {
  const db = useDb();
  const toast = useToast();
  const saved = useData(orgDefaultThemeId, []);
  const [saving, setSaving] = useState<string | null>(null);
  if (saved === undefined) return <p className="muted">{t('auth.loading')}</p>;
  const current = saving ?? saved ?? 'classic'; // optimistic while saving; no default saved shows Classic
  const manage = can(role, 'ManageThemes');

  const choose = async (id: string) => {
    setSaving(id);
    try {
      await db.mutate('setDefaultTheme', { themeId: id });
      toast(t('themes.saved'));
    } catch {
      toast(t('themes.saveFailed'));
    } finally {
      setSaving(null);
    }
  };

  return (
    <section>
      <h1>{t('themes.title')}</h1>
      <p className="muted">{t('themes.text')}</p>
      <ul className="theme-grid" aria-label={t('themes.title')}>
        {listThemes().map((theme) => (
          <li key={theme.id} className="card theme-card" data-testid={`theme-${theme.id}`}>
            <div className="theme-preview">
              <SlideView slide={SAMPLE} theme={theme} label={false} />
            </div>
            <div className="row">
              <strong className="grow">{theme.name}</strong>
              {theme.id === current && <span className="badge">{t('themes.default')}</span>}
            </div>
            <p className="muted small">{theme.description}</p>
            {manage && theme.id !== current && (
              <Button disabled={saving !== null} onClick={() => void choose(theme.id)}>
                {t('themes.useAsDefault')}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
