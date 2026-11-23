// What Inställningar's lists can do (`libraryPageView`, crates/gp-core/src/library_pages.rs), which the web, the Mac
// and iOS read, against what the web's pages decided themselves before: by the role's permission, for every role.
import { describe, expect, it } from 'vitest';
import { can, type Permission, type Role } from '@gp/core';
import { libraryPage } from '../src/db/pageCore.ts';

const roles: Role[] = ['user', 'admin', 'superAdmin'];

describe('libraryPageView', () => {
  it.each([
    ['images', 'ManageImages'],
    ['audios', 'ManageAudios'],
    ['videos', 'ManageVideos'],
    ['themes', 'ManageThemes'],
  ] as [string, Permission][])('lets %s be added to and picked by a role that may %s, as the page did', (kind, permission) => {
    for (const role of roles) {
      const page = libraryPage(kind, role);

      expect([page.pick, page.add !== null]).toEqual([can(role, permission), can(role, permission)]);
    }
  });

  it('offers + on Användare to a role that may manage users, as the page did', () => {
    for (const role of roles) {
      const page = libraryPage('users', role);

      expect(page.add !== null).toBe(can(role, 'ManageUsers'));
    }
  });

  it('names Ny användare on a host and Bjud in elsewhere, as the page did', () => {
    const onHost = libraryPage('users', 'admin', true);
    const elsewhere = libraryPage('users', 'admin', false);

    expect([onHost.add?.text, elsewhere.add?.text]).toEqual(['users.create', 'users.invite']);
  });

  it('lets every role pick songs, Bibles, slideshows and overlays, as their pages always did', () => {
    for (const kind of ['songs', 'bibles', 'customSlides', 'overlays']) {
      const page = libraryPage(kind, 'user');

      expect(page.pick).toBe(true);
    }
  });
});
