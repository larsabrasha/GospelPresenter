// Roles and permissions (spec 01 "Role and permission"). Permissions follow
// from the role only. Only the permissions something checks are listed.

export type Role = 'user' | 'admin' | 'superAdmin';

export type Permission =
  | 'ViewPresentations'
  | 'ManagePresentations'
  | 'ViewSongs'
  | 'ManageSongs'
  | 'ManageTemplates'
  | 'ViewBibles'
  | 'ManageBibles'
  | 'ViewThemes'
  | 'ManageThemes'
  | 'ViewImages'
  | 'ManageImages'
  | 'ViewAudios'
  | 'ManageAudios'
  | 'ViewOverlays'
  | 'ManageOverlays'
  | 'ViewUsers'
  | 'ManageUsers'
  | 'ManageRemoteDisplays'
  | 'ManageOrganizations'
  | 'AssignSuperAdminRole';

const everyone: Permission[] = ['ViewPresentations', 'ManagePresentations', 'ViewSongs', 'ManageSongs', 'ViewBibles', 'ViewThemes', 'ViewImages', 'ManageImages', 'ViewAudios', 'ManageAudios', 'ViewOverlays', 'ManageOverlays'];
/** Importing and deleting Bibles is for admins (D24); everyone uses them. */
const admin: Permission[] = [...everyone, 'ManageTemplates', 'ManageBibles', 'ManageThemes', 'ViewUsers', 'ManageUsers', 'ManageRemoteDisplays'];

const grants: Record<Role, ReadonlySet<Permission>> = {
  user: new Set(everyone),
  admin: new Set(admin),
  superAdmin: new Set([...admin, 'ManageOrganizations', 'AssignSuperAdminRole']),
};

/**
 * The permission policy: a pure function, used by mutators on both ends, by
 * the server's API and by the UI. An unknown role has no permissions.
 */
export function can(role: Role, permission: Permission): boolean {
  return Object.hasOwn(grants, role) && grants[role].has(permission);
}
