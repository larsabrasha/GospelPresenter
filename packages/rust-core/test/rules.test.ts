// The permission table and limits the server's own routes keep in TS (packages/core: permissions.ts, mutation.ts,
// custom-slides.ts, media.ts) against the core's (`rulesView`), which the web and every other shell read: one truth,
// held so by this test.
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { can, CUSTOM_LIMITS, LIMITS, MAX_VERSES_PER_ITEM, MEDIA_LIMITS, type Permission, type Role } from '@gp/core';
import { runMutation, type Rows } from '../src/index.ts';
import { nodeRustCore } from '../src/node.ts';

interface Rules {
  permissions: Record<Role, Permission[]>;
  limits: Record<string, number>;
}
const rules = () => nodeRustCore().pure<Rules>('rulesView', {});

const PERMISSIONS: Permission[] = [
  'ViewPresentations', 'ManagePresentations', 'ViewSongs', 'ManageSongs', 'ViewTemplates', 'ManageTemplates', 'ViewBibles', 'ManageBibles',
  'ViewThemes', 'ManageThemes', 'ViewImages', 'ManageImages', 'ViewAudios', 'ManageAudios', 'ViewVideos', 'ManageVideos', 'ViewOverlays',
  'ManageOverlays', 'ViewUsers', 'ManageUsers', 'ManageRemoteDisplays', 'ManageOrganizationSettings', 'ViewCcliReport', 'ManageCcliReport',
  'ManageOrganizations',
];

describe('rulesView', () => {
  it.each<Role>(['user', 'admin', 'superAdmin'])('grants a %s what the TS table grants', (role) => {
    const { permissions } = rules();

    expect(permissions[role].toSorted()).toEqual(PERMISSIONS.filter((p) => can(role, p)).toSorted());
  });

  it('holds the limits the TS constants hold', () => {
    const { limits } = rules();

    expect(limits).toEqual({
      songs: LIMITS.songs,
      partsPerSong: LIMITS.partsPerSong,
      arrangementsPerSong: LIMITS.arrangementsPerSong,
      itemsPerPresentation: LIMITS.itemsPerPresentation,
      versesPerItem: MAX_VERSES_PER_ITEM,
      customSlides: CUSTOM_LIMITS.slides,
      customElements: CUSTOM_LIMITS.elements,
      customPages: CUSTOM_LIMITS.pages,
      customText: CUSTOM_LIMITS.text,
      fileName: MEDIA_LIMITS.fileName,
    });
  });
});

/** An organisation's database in memory with a presentation `p1` and its heading `i1`, and a mutator run over it. */
function org() {
  const db = new DatabaseSync(':memory:');
  const all = (sql: string, params: unknown[] = []) => {
    const st = db.prepare(sql);
    st.setReturnArrays(true);
    return st.all(...(params as never[])) as unknown as Rows;
  };
  const core = nodeRustCore();
  core.runSync('migrateOrgSchema', {}, undefined, all);
  const mutate = (name: string, args: object) => runMutation({ core, rows: all }, name, args, { userId: 'u', role: 'admin', now: 1000 });
  return { mutate, ready: mutate('createPresentation', { id: 'p1', name: 'Söndag' }).then(() => mutate('addHeaderToPresentation', { itemId: 'i1', presentationId: 'p1', title: 'Lovsång' })) };
}

type Field = 'presentationName' | 'itemTitle' | 'itemNote' | 'location' | 'description';

/** Each field's mutator, setting it to `text`. */
const SETTERS: Record<Field, (text: string) => [string, object]> = {
  presentationName: (text) => ['updatePresentation', { id: 'p1', name: text }],
  itemTitle: (text) => ['renameItem', { itemId: 'i1', title: text }],
  itemNote: (text) => ['setItemNote', { itemId: 'i1', note: text }],
  location: (text) => ['updatePresentation', { id: 'p1', location: text }],
  description: (text) => ['updatePresentation', { id: 'p1', description: text }],
};

describe("rulesView's fields", () => {
  const fields = () => nodeRustCore().pure<{ fields: Record<Field, { required: boolean; max: number }> }>('rulesView', {}).fields;

  it('names a rule for each field a shell asks for', () => {
    expect(Object.keys(fields()).toSorted()).toEqual(Object.keys(SETTERS).toSorted());
  });

  it.each(Object.keys(SETTERS) as Field[])('lets %s take its most characters, as its mutator does', async (field) => {
    const { mutate, ready } = org();
    await ready;
    const [name, args] = SETTERS[field]('x'.repeat(fields()[field].max));

    const saved = mutate(name, args);

    await expect(saved).resolves.toBeUndefined();
  });

  it.each(Object.keys(SETTERS) as Field[])('refuses %s one character over its most, as its mutator does', async (field) => {
    const { mutate, ready } = org();
    await ready;
    const [name, args] = SETTERS[field]('x'.repeat(fields()[field].max + 1));

    const saved = mutate(name, args);

    await expect(saved).rejects.toMatchObject({ code: 'invalid-args' });
  });

  it.each(Object.keys(SETTERS) as Field[])('takes %s empty exactly when it is not required', async (field) => {
    const { mutate, ready } = org();
    await ready;
    const [name, args] = SETTERS[field]('  ');

    const saved = mutate(name, args).then(() => 'taken', () => 'refused');

    expect(await saved).toBe(fields()[field].required ? 'refused' : 'taken');
  });
});
