// What Användare and Enheter offer before anything is pressed (crates/gp-core/src/settings_models.rs, `userRulesView`),
// proved against packages/core's accounts.ts as the web's UserDetail.tsx and Devices.tsx ask it, over every actor and
// member there can be.
import { accountRefusal, can, removeUserRefusal, roleChangeRefusal, ROLES, type MemberRole, type Role } from '@gp/core';
import { describe, expect, it } from 'vitest';
import { nodeRustCore } from '../src/node.ts';

type Rules = { id: string; self: boolean; canEdit: boolean; roles: string[]; roleLocked: boolean; canAccount: boolean; canRemove: boolean; pairAs: boolean };
type Member = { id: string; role: MemberRole; superAdmin: boolean; onlyHere: boolean };

const ACTOR_ROLES: Role[] = ['user', 'admin', 'superAdmin'];
const MEMBERS: Member[] = (['me', 'other'] as const).flatMap((id) =>
  ROLES.flatMap((role) => [false, true].flatMap((superAdmin) => [false, true].map((onlyHere) => ({ id, role, superAdmin, onlyHere })))),
);

/** The web's answers, as UserDetail.tsx and Devices.tsx ask accounts.ts (two Admins assumed, as the web does). */
function web(role: Role, u: Member, host: boolean): Omit<Rules, 'id'> {
  const actor = { id: 'me', role };
  const self = u.id === 'me';
  return {
    self,
    canEdit: role === 'superAdmin',
    roles: ROLES.filter((r) => r === u.role || !roleChangeRefusal(actor, u, r, 2)),
    roleLocked: self || !can(role, 'ManageUsers'),
    canAccount: self || !accountRefusal(actor, { hostOnly: host && u.onlyHere, superAdmin: u.superAdmin }),
    canRemove: !self && !removeUserRefusal(actor, u, 2),
    pairAs: self || !accountRefusal(actor, { hostOnly: u.onlyHere, superAdmin: u.superAdmin }),
  };
}

describe('userRulesView', () => {
  it('offers what the web offers for every actor, member and host', () => {
    const cases = ACTOR_ROLES.flatMap((role) => [false, true].map((host) => ({ role, host })));

    const answers = cases.flatMap(({ role, host }) => {
      const { users } = nodeRustCore().pure<{ users: Rules[] }>('userRulesView', { actor: { id: 'me', role }, users: MEMBERS, host });
      return MEMBERS.map((u, i) => ({ role, host, u, rules: users[i] }));
    });

    expect(answers).toEqual(answers.map(({ role, host, u }) => ({ role, host, u, rules: { id: u.id, ...web(role, u, host) } })));
  });

  it('keeps an Admin from removing a Superadmin', () => {
    const { users } = nodeRustCore().pure<{ users: Rules[] }>('userRulesView', {
      actor: { id: 'me', role: 'admin' },
      users: [{ id: 'sa', role: 'admin', superAdmin: true, onlyHere: false }],
    });

    expect(users[0]!.canRemove).toBe(false);
  });
});
