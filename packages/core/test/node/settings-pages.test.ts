// Inställningar's pages as the core lays them out: the themes.
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { Core, type Rows } from '../../src/core.ts';

/** An organisation's database in memory, migrated by the core, with `sql` run in it. */
function org(sql = '') {
  const db = new DatabaseSync(':memory:');
  const all = (q: string, params: unknown[]) => {
    const st = db.prepare(q);
    st.setReturnArrays(true);
    return st.all(...(params as never[])) as unknown as Rows;
  };
  new Core().runSync('migrateOrgSchema', all);
  if (sql) db.exec(sql);
  return async (q: string, params: unknown[]) => all(q, params);
}

interface ThemesPage {
  themes: { id: string; default: boolean; actions: { id: string }[] }[];
  canAdd: boolean;
}

describe('themesPageView', () => {
  const OWN = `INSERT INTO themes (id, name, definition, sort, updated_at) VALUES ('own', 'Vårt', '{}', 0, 0);
               INSERT INTO org_settings (id, value) VALUES ('defaultThemeId', 'own');`;

  it('lists the built-in themes first, then the own, with the default marked', async () => {
    const rows = org(OWN);

    const page = await new Core().view<ThemesPage>('themesPageView', { role: 'admin' }, rows);

    expect(page.themes.map((t) => [t.id, t.default])).toEqual([['classic', false], ['light', false], ['own', true]]);
  });

  it('offers editing and deleting an own theme only, and no default for the default', async () => {
    const rows = org(OWN);

    const page = await new Core().view<ThemesPage>('themesPageView', { role: 'admin' }, rows);

    expect(page.themes.map((t) => t.actions.map((a) => a.id))).toEqual([['default', 'duplicate'], ['default', 'duplicate'], ['edit', 'duplicate', 'delete']]);
  });

  it('offers nothing to one who may not manage themes', async () => {
    const rows = org(OWN);

    const page = await new Core().view<ThemesPage>('themesPageView', { role: 'user' }, rows);

    expect([page.canAdd, page.themes.flatMap((t) => t.actions)]).toEqual([false, []]);
  });

  it('shows Classic as the default when the chosen theme is gone', async () => {
    const rows = org(`INSERT INTO org_settings (id, value) VALUES ('defaultThemeId', 'deleted')`);

    const page = await new Core().view<ThemesPage>('themesPageView', { role: 'admin' }, rows);

    expect(page.themes.find((t) => t.default)?.id).toBe('classic');
  });
});

