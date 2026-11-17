// The permission table and limits the server's own routes keep in TS (packages/core: permissions.ts, mutation.ts,
// custom-slides.ts, media.ts) against the core's (`rulesView`), which the web and every other shell read: one truth,
// held so by this test.
import { describe, expect, it } from 'vitest';
import { can, CUSTOM_LIMITS, LIMITS, MAX_VERSES_PER_ITEM, MEDIA_LIMITS, type Permission, type Role } from '@gp/core';
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
