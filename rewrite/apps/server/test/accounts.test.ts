// The global tables against a fake clock: expiry, throttling, caps and
// single use, which the HTTP tests cannot wait for. On both Node drivers.
import { describe, expect, it } from 'vitest';
import { ACCOUNT_LIMITS } from '@gp/core';
import { hashPassword, newDigits, verifyPassword } from '../src/crypto.ts';
import { Accounts, migrateGlobal, THROTTLE } from '../src/global.ts';
import { nodeGlobalSql, openSqlite, type NodeDriver } from '@gp/server/node';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

async function fresh(driver: NodeDriver) {
  const clock = { now: 1_000_000 };
  const sql = nodeGlobalSql(openSqlite(':memory:', driver));
  await migrateGlobal(sql);
  const accounts = new Accounts(sql, { now: () => clock.now });
  const setup = await accounts.setup({ name: 'Anna', orgName: 'Lilla Kyrkan', email: 'anna@x.se', passwordHash: await hashPassword('correct horse', 1000) });
  if (setup === 'setup-done') throw new Error('setup');
  return { clock, accounts, ...setup };
}

describe('crypto', () => {
  it('PBKDF2 hashes verify only with the right password, and carry their parameters', async () => {
    const h = await hashPassword('correct horse battery', 1000);
    expect(h).toMatch(/^pbkdf2-sha256\$1000\$[\w-]{22}\$[\w-]{43}$/);
    expect(await verifyPassword('correct horse battery', h)).toBe(true);
    expect(await verifyPassword('correct horse batter', h)).toBe(false);
    expect(await verifyPassword('anything', null)).toBe(false); // no account: hashed anyway, never true
    expect(await verifyPassword('x', 'md5$1$a$b')).toBe(false);
    expect(await hashPassword('same', 1000)).not.toBe(await hashPassword('same', 1000)); // salted
  });

  it('pairing codes are six digits', () => {
    for (let i = 0; i < 200; i++) expect(newDigits(6)).toMatch(/^\d{6}$/);
  });
});

describe.each<NodeDriver>(['better-sqlite3', 'node:sqlite'])('accounts, %s', (driver) => {
  it('setup happens once: a second setup creates nothing', async () => {
    const { accounts } = await fresh(driver);
    expect(await accounts.setup({ name: 'Eve', orgName: 'Evil', email: 'eve@x.se', passwordHash: 'x' })).toBe('setup-done');
    expect(await accounts.sql.all('SELECT name FROM users')).toEqual([{ name: 'Anna' }]);
    expect(await accounts.sql.all('SELECT count(*) AS n FROM orgs')).toEqual([{ n: 1 }]);
  });

  it('a session is refused once revoked, once idle too long, and once its user is deleted; use renews it', async () => {
    const { accounts, clock, userId, orgId } = await fresh(driver);
    const a = await accounts.createSession(userId, orgId, 'Mac');
    expect(await accounts.session(a.token)).toMatchObject({ userId, orgId, role: 'superAdmin' });
    // Used at day 80, so day 160 is still within 90 idle days.
    clock.now += 80 * DAY;
    expect(await accounts.session(a.token)).not.toBeNull();
    clock.now += 80 * DAY;
    expect(await accounts.session(a.token)).not.toBeNull();
    clock.now += ACCOUNT_LIMITS.sessionIdleMs + 1;
    expect(await accounts.session(a.token)).toBeNull();

    const b = await accounts.createSession(userId, orgId, 'Mac');
    await accounts.revokeSession(b.sessionId);
    expect(await accounts.session(b.token)).toBeNull();
    expect(await accounts.session('gpdt_' + b.token.slice(5).split('').toReversed().join(''))).toBeNull();
    expect(await accounts.session('not a token')).toBeNull();
  });

  it('at most 10 active sessions per user: the least recently used is revoked (AUTH-R8)', async () => {
    const { accounts, clock, userId, orgId } = await fresh(driver);
    const sessions = [];
    for (let i = 0; i < 11; i++) {
      clock.now += 1000;
      sessions.push(await accounts.createSession(userId, orgId, `device ${i}`));
    }
    expect(await accounts.session(sessions[0]!.token)).toBeNull();
    for (const s of sessions.slice(1)) expect(await accounts.session(s.token)).not.toBeNull();
  });

  it('an invite is valid for 7 days and once; using it sets the password and revokes other sessions', async () => {
    const { accounts, clock, orgId } = await fresh(driver);
    const bo = await accounts.createUser(orgId, { name: 'Bo', email: 'bo@x.se', role: 'user' });
    if (typeof bo === 'string') throw new Error(bo);
    expect(await accounts.invite(bo.inviteToken)).toEqual({ state: 'valid', name: 'Bo', orgName: 'Lilla Kyrkan', email: 'bo@x.se' });

    clock.now += ACCOUNT_LIMITS.inviteTtlMs;
    expect(await accounts.invite(bo.inviteToken)).toEqual({ state: 'expired' });
    expect(await accounts.acceptInvite(bo.inviteToken, 'h')).toBe('invite-expired');

    const fresh2 = await accounts.createInvite(bo.id, orgId);
    if (fresh2 === 'limit') throw new Error('limit');
    const old = await accounts.createSession(bo.id, orgId, 'old phone');
    expect(await accounts.acceptInvite(fresh2, await hashPassword('new password', 1000))).toEqual({ userId: bo.id, orgId });
    expect(await accounts.session(old.token)).toBeNull();
    expect(await accounts.invite(fresh2)).toEqual({ state: 'invalid' });
    expect(await accounts.acceptInvite(fresh2, 'other')).toBe('invite-invalid'); // replayed
    expect(await verifyPassword('new password', (await accounts.userByEmail('bo@x.se'))!.passwordHash)).toBe(true);
    expect(await accounts.invite('gpin_unknown')).toEqual({ state: 'invalid' });
  });

  it('at most 20 unused invites per user, expired ones included (AUTH-R3); 100 users per organisation (ORG-R10)', async () => {
    const { accounts, orgId } = await fresh(driver);
    const bo = await accounts.createUser(orgId, { name: 'Bo', email: 'bo@x.se', role: 'user' });
    if (typeof bo === 'string') throw new Error(bo);
    for (let i = 1; i < ACCOUNT_LIMITS.unusedInvitesPerUser; i++) expect(await accounts.createInvite(bo.id, orgId)).toMatch(/^gpin_/);
    expect(await accounts.createInvite(bo.id, orgId)).toBe('limit');

    for (let i = 2; i < ACCOUNT_LIMITS.usersPerOrg; i++) {
      expect(typeof (await accounts.createUser(orgId, { name: `U${i}`, email: `u${i}@x.se`, role: 'user' }))).toBe('object');
    }
    expect(await accounts.createUser(orgId, { name: 'One too many', email: 'more@x.se', role: 'user' })).toBe('limit');
    expect(await accounts.sql.all('SELECT count(*) AS n FROM users WHERE email = ?', ['more@x.se'])).toEqual([{ n: 0 }]);
  });

  it('an email belongs to one user', async () => {
    const { accounts, orgId } = await fresh(driver);
    expect(await accounts.createUser(orgId, { name: 'Anna 2', email: 'anna@x.se', role: 'user' })).toBe('email-taken');
  });

  it('deleting a user takes their sessions, invites and membership', async () => {
    const { accounts, orgId } = await fresh(driver);
    const bo = await accounts.createUser(orgId, { name: 'Bo', email: 'bo@x.se', role: 'admin' });
    if (typeof bo === 'string') throw new Error(bo);
    const s = await accounts.createSession(bo.id, orgId, 'x');
    await accounts.deleteUser(bo.id);
    expect(await accounts.session(s.token)).toBeNull();
    expect(await accounts.invite(bo.inviteToken)).toEqual({ state: 'invalid' });
    expect(await accounts.member(bo.id, orgId)).toBeNull();
  });

  it('throttling: 5 failures lock an account for a minute, then each failure doubles it up to 15 minutes', async () => {
    const { accounts, clock } = await fresh(driver);
    const p = THROTTLE.account;
    for (let i = 0; i < p.free - 1; i++) await accounts.fail('account:a', p);
    expect(await accounts.lockedUntil(['account:a'])).toBe(0);
    await accounts.fail('account:a', p);
    expect(await accounts.lockedUntil(['account:a'])).toBe(clock.now + MIN);
    await accounts.fail('account:a', p);
    expect(await accounts.lockedUntil(['account:a'])).toBe(clock.now + 2 * MIN);
    for (let i = 0; i < 10; i++) await accounts.fail('account:a', p);
    expect(await accounts.lockedUntil(['account:a', 'address:x'])).toBe(clock.now + 15 * MIN);
    clock.now += 15 * MIN + 1;
    expect(await accounts.lockedUntil(['account:a'])).toBe(0);
    // A failure after the window starts counting again.
    await accounts.fail('account:a', p);
    expect(await accounts.lockedUntil(['account:a'])).toBe(0);
    await accounts.clearThrottle('account:a');
    expect(await accounts.sql.all('SELECT * FROM auth_throttle')).toEqual([]);
  });

  it('pairing: one code at a time, single use, 10 minutes, dead after 5 wrong guesses', async () => {
    const { accounts, clock } = await fresh(driver);
    await accounts.newPairCode('111111', ACCOUNT_LIMITS.pairCodeTtlMs);
    await accounts.newPairCode('222222', ACCOUNT_LIMITS.pairCodeTtlMs); // replaces the first
    expect(await accounts.claimPairCode('111111', 'iPad', 5)).toBeNull();
    const token = await accounts.claimPairCode('222222', 'iPad', 5);
    expect(token).toMatch(/^gppd_[\w-]{43}$/);
    expect(await accounts.pairedDevice(token!)).toBe(true);
    expect(await accounts.claimPairCode('222222', 'iPad 2', 5)).toBeNull(); // replayed

    await accounts.newPairCode('333333', ACCOUNT_LIMITS.pairCodeTtlMs);
    clock.now += ACCOUNT_LIMITS.pairCodeTtlMs;
    expect(await accounts.claimPairCode('333333', 'late', 5)).toBeNull();

    await accounts.newPairCode('444444', ACCOUNT_LIMITS.pairCodeTtlMs);
    for (let i = 0; i < 5; i++) expect(await accounts.claimPairCode(String(500000 + i), 'guess', 5)).toBeNull();
    expect(await accounts.claimPairCode('444444', 'right, too late', 5)).toBeNull();

    const [device] = await accounts.pairedDevices();
    expect(device).toMatchObject({ name: 'iPad', revokedAt: null });
    expect(await accounts.revokeDevice(device!.id)).toBe(true);
    expect(await accounts.pairedDevice(token!)).toBe(false);
    expect(await accounts.pairedDevice('gppd_forged')).toBe(false);
  });
});
