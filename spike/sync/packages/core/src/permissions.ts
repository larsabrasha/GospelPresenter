export type Role = 'viewer' | 'editor' | 'admin';

export type Action = 'presentations.edit' | 'presentations.purge' | 'songs.edit';

const grants: Record<Role, readonly Action[]> = {
  viewer: [],
  editor: ['presentations.edit', 'songs.edit'],
  admin: ['presentations.edit', 'presentations.purge', 'songs.edit'],
};

/** The permission policy: a pure function, used by mutators on both ends and by the UI. */
export function can(role: Role, action: Action): boolean {
  return grants[role].includes(action);
}
