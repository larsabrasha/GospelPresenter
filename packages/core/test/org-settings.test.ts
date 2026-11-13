import { describe, expect, it } from 'vitest';
import { can, mutators, remoteControlAllowed, remoteControlPolicy } from '@gp/core';

// TODO.md "Remote control for the whole organisation".
describe('remote control policy', () => {
  it('is the presenter\'s choice when nothing is saved', () => {
    expect(remoteControlPolicy(undefined)).toBe('presenter');
  });

  it('is the presenter\'s choice for a value this build does not know', () => {
    expect(remoteControlPolicy('sometimes')).toBe('presenter');
  });

  it('reads a saved value', () => {
    expect(remoteControlPolicy('never')).toBe('never');
  });

  it('under never refuses even when the window allows it', () => {
    expect(remoteControlAllowed('never', true)).toBe(false);
  });

  it('under always allows even when the window does not', () => {
    expect(remoteControlAllowed('always', false)).toBe(true);
  });

  it('under the presenter\'s choice follows the window', () => {
    expect([remoteControlAllowed('presenter', true), remoteControlAllowed('presenter', false)]).toEqual([true, false]);
  });

  it('is set only by admins', () => {
    expect([can('user', 'ManageOrganizationSettings'), can('admin', 'ManageOrganizationSettings'), can('superAdmin', 'ManageOrganizationSettings')]).toEqual([false, true, true]);
  });

  it('takes only the three choices as an argument', () => {
    expect(mutators.setRemoteControl.args.safeParse({ policy: 'sometimes' }).success).toBe(false);
  });
});
