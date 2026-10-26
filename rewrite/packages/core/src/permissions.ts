// Roles and permissions (spec 01 "Role and permission"). Permissions follow
// from the role only. Milestone 1 uses the permissions its mutations need.

export type Role = 'user' | 'admin' | 'superAdmin';

export type Permission =
  | 'ViewPresentations'
  | 'ManagePresentations'
  | 'ViewSongs'
  | 'ManageSongs'
  | 'ManageTemplates'
  | 'ManageThemes'
  | 'ManageUsers'
  | 'ManageOrganizations';

const everyone: Permission[] = ['ViewPresentations', 'ManagePresentations', 'ViewSongs', 'ManageSongs'];
const admin: Permission[] = [...everyone, 'ManageTemplates', 'ManageThemes', 'ManageUsers'];

const grants: Record<Role, ReadonlySet<Permission>> = {
  user: new Set(everyone),
  admin: new Set(admin),
  superAdmin: new Set([...admin, 'ManageOrganizations']),
};

/** The permission policy: a pure function, used by mutators on both ends and by the UI. */
export function can(role: Role, permission: Permission): boolean {
  return grants[role].has(permission);
}
