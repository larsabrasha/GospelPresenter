// The global tables against a fake clock: expiry, throttling, caps and
// single use, which the HTTP tests cannot wait for. On both Node drivers.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ACCOUNT_LIMITS } from '@gp/core';
import { newDigits, pkceChallenge, sha256 } from '../src/crypto.ts';
import { Accounts, LOGIN_FLOW, migrateGlobal, PASSKEY_FLOW, THROTTLE, type NewLogin } from '../src/global/index.ts';
import { decodeCbor, derToRaw, Passkeys } from '../src/webauthn.ts';
import { nodeGlobalSql, openSqlite, type NodeDriver } from '@gp/server/node';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

async function fresh(driver: NodeDriver) {
  const clock = { now: 1_000_000 };
  const sql = nodeGlobalSql(openSqlite(':memory:', driver));
  await migrateGlobal(sql);
  const accounts = new Accounts(sql, { now: () => clock.now });
  const setup = await accounts.members.setup({ name: 'Anna', orgName: 'Lilla Kyrkan' });
  if (setup === 'setup-done') throw new Error('setup');
  // The Superadmin links Google through the setup invite.
  const linked = await accounts.signIn.signInWithGoogle(google('anna'), await sha256(setup.inviteToken));
  if (typeof linked === 'string') throw new Error(linked);
  return { clock, accounts, ...setup };
}

const google = (sub: string, email: string | null = `${sub}@gmail.com`) => ({ sub: `sub-${sub}`, email, name: sub });

/** Someone invited to `orgId` who made their account with the Google account `sub`; their user id. */
async function newMember(accounts: Accounts, orgId: string, by: string, sub: string): Promise<string> {
  const inv = await accounts.invitations.create(orgId, { email: `${sub}@x.se`, role: 'user', mailed: false, byUserId: by });
  if (typeof inv === 'string') throw new Error(inv);
  const r = await accounts.signIn.signInWithGoogle(google(sub), await sha256(inv.token));
  if (typeof r === 'string') throw new Error(r);
  return r.userId;
}

describe('crypto', () => {
  it('the PKCE challenge is RFC 7636\'s S256: base64url of the SHA-256, no padding', async () => {
    const verifier = 'a-verifier_of-43-characters-0123456789abcde';
    expect(await pkceChallenge(verifier)).toBe(createHash('sha256').update(verifier).digest('base64url'));
  });

  it('pairing codes are six digits', () => {
    for (let i = 0; i < 200; i++) expect(newDigits(6)).toMatch(/^\d{6}$/);
  });
});

describe.each<NodeDriver>(['better-sqlite3', 'node:sqlite'])('accounts, %s', (driver) => {
  it('setup happens once: a second setup after its Superadmin linked Google creates nothing', async () => {
    const { accounts } = await fresh(driver);
    expect(await accounts.members.setupDone()).toBe(true);
    expect(await accounts.members.setup({ name: 'Eve', orgName: 'Evil' })).toBe('setup-done');
    expect(await accounts.sql.all('SELECT name, email FROM users')).toEqual([{ name: 'Anna', email: 'anna@gmail.com' }]); // filled from Google
    expect(await accounts.sql.all('SELECT count(*) AS n FROM orgs')).toEqual([{ n: 1 }]);
  });

  it('a setup left before signing in can be done again: same Superadmin and organisation, only the newest invite works', async () => {
    const sql = nodeGlobalSql(openSqlite(':memory:', driver));
    await migrateGlobal(sql);
    const accounts = new Accounts(sql);
    const first = await accounts.members.setup({ name: 'Anna', orgName: 'Kyrkan' });
    if (first === 'setup-done') throw new Error('setup');
    expect(await accounts.members.setupDone()).toBe(false);
    const again = await accounts.members.setup({ name: 'Anna Berg', orgName: 'Lilla Kyrkan' });
    if (again === 'setup-done') throw new Error('setup');
    expect(again).toMatchObject({ userId: first.userId, orgId: first.orgId });
    expect(await accounts.members.invite(first.inviteToken)).toEqual({ state: 'invalid' });
    expect(await accounts.signIn.signInWithGoogle(google('anna'), await sha256(again.inviteToken))).toEqual({ userId: first.userId, orgId: first.orgId });
    expect(await accounts.sql.all('SELECT name FROM orgs')).toEqual([{ name: 'Lilla Kyrkan' }]);
    expect(await accounts.members.setup({ name: 'Eve', orgName: 'Evil' })).toBe('setup-done');
  });

  it('Google sign-in: by the linked sub only, never by email; no invite and no link is refused (AUTH-R4)', async () => {
    const { accounts, userId, orgId } = await fresh(driver);
    expect(await accounts.signIn.signInWithGoogle(google('anna', 'new-address@gmail.com'), null)).toEqual({ userId, orgId }); // email changed at Google
    expect(await accounts.signIn.signInWithGoogle(google('mallory', 'anna@gmail.com'), null)).toBe('not-linked'); // same email, other account
    expect(await accounts.signIn.signInWithGoogle(google('nobody'), null)).toBe('not-linked');
  });

  it('an invitation: an account one has gains the membership, keeping its role; a new Google account makes a new account', async () => {
    const { accounts, orgId, userId } = await fresh(driver);
    const forBo = await accounts.invitations.create(orgId, { email: 'bo@x.se', role: 'user', mailed: false, byUserId: userId });
    if (typeof forBo === 'string') throw new Error(forBo);
    expect(await accounts.signIn.signInWithGoogle(google('anna'), await sha256(forBo.token))).toEqual({ userId, orgId });
    expect(await accounts.members.member(userId, orgId)).toMatchObject({ role: 'admin' });
    expect(await accounts.invitations.lookup(forBo.token)).toEqual({ state: 'invalid' });

    const again = await accounts.invitations.create(orgId, { email: 'bo@x.se', role: 'user', mailed: false, byUserId: userId });
    if (typeof again === 'string') throw new Error(again);
    const bo = await accounts.signIn.signInWithGoogle(google('bo'), await sha256(again.token));
    if (typeof bo === 'string') throw new Error(bo);
    expect(bo.userId).not.toBe(userId);
    // A copied link vouches for nothing: Google's own address is the one confirmed.
    expect(await accounts.sql.all('SELECT name, email, email_confirmed FROM users WHERE id = ?', [bo.userId])).toEqual([{ name: 'bo', email: 'bo@gmail.com', email_confirmed: 1 }]);
    expect(await accounts.signIn.signInWithGoogle(google('bo'), null)).toEqual(bo);
  });

  it('an invitation whose link went only by mail confirms its address; an expired one is refused', async () => {
    const { accounts, clock, orgId, userId } = await fresh(driver);
    const inv = await accounts.invitations.create(orgId, { email: 'cy@x.se', role: 'user', mailed: true, byUserId: userId });
    if (typeof inv === 'string') throw new Error(inv);
    const cy = await accounts.signIn.signInWithGoogle(google('cy'), await sha256(inv.token));
    if (typeof cy === 'string') throw new Error(cy);
    expect(await accounts.sql.all('SELECT email, email_confirmed FROM users WHERE id = ?', [cy.userId])).toEqual([{ email: 'cy@x.se', email_confirmed: 1 }]);
    const late = await accounts.invitations.create(orgId, { email: 'dy@x.se', role: 'user', mailed: true, byUserId: userId });
    if (typeof late === 'string') throw new Error(late);
    clock.now += ACCOUNT_LIMITS.inviteTtlMs;
    expect(await accounts.invitations.lookup(late.token)).toEqual({ state: 'expired' });
    expect(await accounts.signIn.signInWithGoogle(google('dy'), await sha256(late.token))).toBe('invite-expired');
  });

  it('a session is refused once revoked, once idle too long, and once its user is deleted; use renews it', async () => {
    const { accounts, clock, userId, orgId } = await fresh(driver);
    const a = await accounts.members.createSession(userId, orgId, 'Mac');
    expect(await accounts.members.session(a.token)).toMatchObject({ userId, orgId, role: 'admin', superUntil: null });
    // Used at day 80, so day 160 is still within 90 idle days.
    clock.now += 80 * DAY;
    expect(await accounts.members.session(a.token)).not.toBeNull();
    clock.now += 80 * DAY;
    expect(await accounts.members.session(a.token)).not.toBeNull();
    clock.now += ACCOUNT_LIMITS.sessionIdleMs + 1;
    expect(await accounts.members.session(a.token)).toBeNull();

    const b = await accounts.members.createSession(userId, orgId, 'Mac');
    await accounts.members.revokeSession(b.sessionId);
    expect(await accounts.members.session(b.token)).toBeNull();
    expect(await accounts.members.session('gpdt_' + b.token.slice(5).split('').toReversed().join(''))).toBeNull();
    expect(await accounts.members.session('not a token')).toBeNull();
  });

  it('superadminläge ends by itself after an hour', async () => {
    const { accounts, clock, userId, orgId } = await fresh(driver);
    const s = await accounts.members.createSession(userId, orgId, 'Mac');
    await accounts.members.setSuperMode(s.sessionId, clock.now + ACCOUNT_LIMITS.superModeMs);
    expect(await accounts.members.session(s.token)).toMatchObject({ role: 'superAdmin' });
    clock.now += ACCOUNT_LIMITS.superModeMs;
    expect(await accounts.members.session(s.token)).toMatchObject({ role: 'admin', superUntil: null });
  });

  it('with Superadmins in the configuration, only an account that confirmed one of their addresses is one; the mark counts for nothing', async () => {
    const { accounts, userId } = await fresh(driver);
    expect(await accounts.members.isSuperAdmin(userId)).toBe(true); // the mark setup gave
    const configured = new Accounts(accounts.sql, { superAdmins: ['Anna@Gmail.com'] });
    expect(await configured.members.isSuperAdmin(userId)).toBe(true); // Google confirmed anna@gmail.com
    await accounts.sql.run('UPDATE users SET email_confirmed = 0 WHERE id = ?', [userId]);
    expect(await configured.members.isSuperAdmin(userId)).toBe(false);
    expect(await new Accounts(accounts.sql, { superAdmins: ["o'brien@x.se"] }).members.isSuperAdmin(userId)).toBe(false);
    expect(await new Accounts(accounts.sql, { superAdmins: [] }).members.isSuperAdmin(userId)).toBe(false);
  });

  it('at most 10 active sessions per user: the least recently used is revoked (AUTH-R8)', async () => {
    const { accounts, clock, userId, orgId } = await fresh(driver);
    const sessions = [];
    for (let i = 0; i < 11; i++) {
      clock.now += 1000;
      sessions.push(await accounts.members.createSession(userId, orgId, `device ${i}`));
    }
    expect(await accounts.members.session(sessions[0]!.token)).toBeNull();
    for (const s of sessions.slice(1)) expect(await accounts.members.session(s.token)).not.toBeNull();
  });

  it('a reset link is valid for 7 days and once; using it replaces the Google account and revokes other sessions', async () => {
    const { accounts, clock, orgId, userId } = await fresh(driver);
    const bo = await newMember(accounts, orgId, userId, 'bo');
    const first = await accounts.members.createInvite(bo, orgId);
    if (first === 'limit') throw new Error('limit');
    expect(await accounts.members.invite(first)).toEqual({ state: 'valid', kind: 'reset', name: 'bo', orgName: 'Lilla Kyrkan', email: 'bo@gmail.com' });
    clock.now += ACCOUNT_LIMITS.inviteTtlMs;
    expect(await accounts.members.invite(first)).toEqual({ state: 'expired' });
    expect(await accounts.signIn.signInWithGoogle(google('bo'), await sha256(first))).toBe('invite-expired');

    const old = await accounts.members.createSession(bo, orgId, 'old phone');
    const second = await accounts.members.createInvite(bo, orgId);
    if (second === 'limit') throw new Error('limit');
    expect(await accounts.signIn.signInWithGoogle(google('bo-new'), await sha256(second))).toEqual({ userId: bo, orgId });
    expect(await accounts.members.session(old.token)).toBeNull();
    expect(await accounts.signIn.signInWithGoogle(google('bo'), null)).toBe('not-linked');
    expect(await accounts.signIn.signInWithGoogle(google('bo-new'), null)).toEqual({ userId: bo, orgId });
    expect(await accounts.members.invite(second)).toEqual({ state: 'invalid' });
    expect(await accounts.signIn.signInWithGoogle(google('bo-new'), await sha256(second))).toBe('invite-invalid'); // replayed
    expect(await accounts.members.invite('gpin_unknown')).toEqual({ state: 'invalid' });
  });

  it('at most 20 unused reset links per user (AUTH-R3); members and invitations together at most 100 per organisation (ORG-R10)', async () => {
    const { accounts, orgId, userId } = await fresh(driver);
    const bo = await newMember(accounts, orgId, userId, 'bo');
    for (let i = 0; i < ACCOUNT_LIMITS.unusedInvitesPerUser; i++) expect(await accounts.members.createInvite(bo, orgId)).toMatch(/^gpin_/);
    expect(await accounts.members.createInvite(bo, orgId)).toBe('limit');

    for (let i = 2; i < ACCOUNT_LIMITS.usersPerOrg; i++) {
      expect(typeof (await accounts.invitations.create(orgId, { email: `u${i}@x.se`, role: 'user', mailed: false, byUserId: userId }))).toBe('object');
    }
    expect(await accounts.invitations.create(orgId, { email: 'more@x.se', role: 'user', mailed: false, byUserId: userId })).toBe('limit');
    // An invitation to the same address again replaces the old one, so it fits.
    expect(typeof (await accounts.invitations.create(orgId, { email: 'u2@x.se', role: 'admin', mailed: false, byUserId: userId }))).toBe('object');
  });

  it('the last Admin stays one even when asked twice: the role change and the removal check it in their own statement', async () => {
    const { accounts, orgId, userId } = await fresh(driver);
    const bo = await newMember(accounts, orgId, userId, 'bo');
    await accounts.members.setRole(bo, orgId, 'admin');

    expect(await accounts.members.setRole(userId, orgId, 'user')).toBe('ok');
    expect(await accounts.members.setRole(bo, orgId, 'user')).toBe('last-admin');
    expect(await accounts.members.removeMember(bo, orgId)).toBe('last-admin');
    expect(await accounts.members.member(bo, orgId)).toMatchObject({ role: 'admin' });
    expect(await accounts.sql.all('SELECT count(*) AS n FROM users WHERE id = ?', [bo])).toEqual([{ n: 1 }]);
    expect(await accounts.members.removeMember(userId, orgId)).toBe('ok');
  });

  it('an invitation is not accepted into a full organisation, and stays usable', async () => {
    const { accounts, orgId, userId } = await fresh(driver);
    const inv = await accounts.invitations.create(orgId, { email: 'late@x.se', role: 'user', mailed: false, byUserId: userId });
    if (typeof inv === 'string') throw new Error(inv);
    for (let i = 1; i < ACCOUNT_LIMITS.usersPerOrg; i++) await accounts.members.createLocalUser(orgId, { name: `U${i}`, email: null, role: 'user' });

    expect(await accounts.signIn.signInWithGoogle(google('late'), await sha256(inv.token))).toBe('limit');
    expect(await accounts.invitations.lookup(inv.token)).toMatchObject({ state: 'valid' });
  });

  it('only a confirmed address is unique: an unconfirmed one may be on two accounts; a link confirms it unless another account has', async () => {
    const { accounts, clock, orgId, userId } = await fresh(driver);
    const bo = await newMember(accounts, orgId, userId, 'bo');
    await accounts.members.updateUser(bo, { email: 'anna@gmail.com' });
    expect(await accounts.sql.all('SELECT email, email_confirmed FROM users WHERE id = ?', [bo])).toEqual([{ email: 'anna@gmail.com', email_confirmed: 0 }]);
    // Anna's is confirmed, so Bo gets no link and Google cannot confirm it for him.
    expect(await accounts.emails.startConfirm(bo, 'anna@gmail.com')).toBeNull();
    await accounts.emails.vouch(bo, 'anna@gmail.com');
    expect(await accounts.sql.all('SELECT email_confirmed FROM users WHERE id = ?', [bo])).toEqual([{ email_confirmed: 0 }]);
    // A free address: the link sets it, confirmed, once; an expired link does nothing.
    const link = await accounts.emails.startConfirm(bo, 'bo@new.se');
    expect(await accounts.emails.confirm(link!)).toEqual({ userId: bo });
    expect(await accounts.sql.all('SELECT email, email_confirmed FROM users WHERE id = ?', [bo])).toEqual([{ email: 'bo@new.se', email_confirmed: 1 }]);
    expect(await accounts.emails.confirm(link!)).toBe('invalid');
    const late = await accounts.emails.startConfirm(bo, 'bo@later.se');
    clock.now += ACCOUNT_LIMITS.emailLinkTtlMs;
    expect(await accounts.emails.confirm(late!)).toBe('invalid');
    // Two accounts each with a link to one address: the second to open it is refused.
    const cy = await newMember(accounts, orgId, userId, 'cy');
    const forBo = await accounts.emails.startConfirm(bo, 'shared@x.se');
    const forCy = await accounts.emails.startConfirm(cy, 'shared@x.se');
    expect(await accounts.emails.confirm(forBo!)).toEqual({ userId: bo });
    expect(await accounts.emails.confirm(forCy!)).toBe('email-taken');
    // "Glömt hur du loggar in?" finds only a confirmed address.
    await accounts.members.updateUser(cy, { email: 'cy@x.se' });
    expect(await accounts.members.userByEmail('cy@x.se')).toBeNull();
    expect(await accounts.members.userByEmail('shared@x.se')).toMatchObject({ id: bo });
  });

  it("a Superadmin's import links no Google account to an account that exists, a member's here or anyone's", async () => {
    const { accounts, orgId, userId } = await fresh(driver);
    const bo = await newMember(accounts, orgId, userId, 'bo');

    const outcome = await accounts.legacy.import(orgId, { name: 'Bo', email: 'bo@gmail.com', role: 'admin', google: ['sub-eve'] });

    expect([outcome, await accounts.signIn.signInWithGoogle(google('eve'), null)]).toEqual(['kept', 'not-linked']);
    expect((await accounts.members.member(bo, orgId))?.role).toBe('user');
  });

  it('deleting a user takes their logins, sessions, reset links and membership', async () => {
    const { accounts, orgId, userId } = await fresh(driver);
    const bo = await newMember(accounts, orgId, userId, 'bo');
    const s = await accounts.members.createSession(bo, orgId, 'x');
    const reset = await accounts.members.createInvite(bo, orgId);
    await accounts.members.deleteUser(bo);
    expect(await accounts.signIn.signInWithGoogle(google('bo'), null)).toBe('not-linked');
    expect(await accounts.members.session(s.token)).toBeNull();
    expect(await accounts.members.invite(reset as string)).toEqual({ state: 'invalid' });
    expect(await accounts.members.member(bo, orgId)).toBeNull();
  });

  it('throttling: 20 failures lock an address for 15 minutes; a failure after the window starts counting again', async () => {
    const { accounts, clock } = await fresh(driver);
    const p = THROTTLE.address;
    for (let i = 0; i < p.free - 1; i++) await accounts.throttle.fail('address:a', p);
    expect(await accounts.throttle.lockedUntil(['address:a'])).toBe(0);
    await accounts.throttle.fail('address:a', p);
    expect(await accounts.throttle.lockedUntil(['address:a', 'address:b'])).toBe(clock.now + 15 * MIN);
    clock.now += 15 * MIN + 1;
    expect(await accounts.throttle.lockedUntil(['address:a'])).toBe(0);
    await accounts.throttle.fail('address:a', p);
    expect(await accounts.throttle.lockedUntil(['address:a'])).toBe(0);
    await accounts.throttle.clear('address:a');
    expect(await accounts.sql.all('SELECT * FROM auth_throttle')).toEqual([]);
  });

  it('a sign-in flow starts once, in one browser, is taken once, and dies after 10 minutes', async () => {
    const { accounts, clock } = await fresh(driver);
    const flow = { address: '10.0.0.1', inviteToken: null, deviceName: 'Mac', callbackScheme: 'gospelpresenter' };
    const state = (await accounts.signIn.createFlow(flow)) as string;
    expect(state).toMatch(/^[\w-]{43}$/);
    const started = await accounts.signIn.startFlow(state, 'browser-a');
    expect(started?.verifier).toMatch(/^[\w-]{43}$/);
    expect(await accounts.signIn.startFlow(state, 'browser-b')).toBeNull(); // started already
    expect(await accounts.signIn.takeFlow(state, 'browser-b')).toBeNull(); // another browser
    expect(await accounts.signIn.takeFlow('forged', 'browser-a')).toBeNull();
    expect(await accounts.signIn.takeFlow(state, 'browser-a')).toMatchObject({ nonce: started!.nonce, verifier: started!.verifier, callbackScheme: 'gospelpresenter' });
    expect(await accounts.signIn.takeFlow(state, 'browser-a')).toBeNull(); // replayed

    const late = (await accounts.signIn.createFlow(flow)) as string;
    await accounts.signIn.startFlow(late, 'browser-a');
    clock.now += LOGIN_FLOW.ttlMs;
    expect(await accounts.signIn.takeFlow(late, 'browser-a')).toBeNull();
  });

  it('at most 20 open sign-in flows per address; a web handoff is collected once', async () => {
    const { accounts, userId, orgId } = await fresh(driver);
    const flow = { address: '10.0.0.2', inviteToken: null, deviceName: '', callbackScheme: null };
    const states = [];
    for (let i = 0; i < LOGIN_FLOW.perAddress; i++) states.push(await accounts.signIn.createFlow(flow));
    expect(await accounts.signIn.createFlow(flow)).toBe('limit');
    expect(await accounts.signIn.createFlow({ ...flow, address: '10.0.0.3' })).toMatch(/^[\w-]{43}$/);

    await accounts.signIn.setHandoff(states[0] as string, 'handoff-secret', userId, orgId);
    expect(await accounts.signIn.takeHandoff('wrong')).toBeNull();
    expect(await accounts.signIn.takeHandoff('handoff-secret')).toEqual({ userId, orgId });
    expect(await accounts.signIn.takeHandoff('handoff-secret')).toBeNull();
  });

  it('pairing: one code at a time, single use, 10 minutes, dead after 5 wrong guesses', async () => {
    const { accounts, clock, userId, orgId } = await fresh(driver);
    const code = (c: string) => accounts.pairing.newPairCode(c, ACCOUNT_LIMITS.pairCodeTtlMs, userId, orgId);
    await code('111111');
    await code('222222'); // replaces the first
    expect(await accounts.pairing.claimPairCode('111111', 'iPad', 5)).toBeNull();
    const claimed = await accounts.pairing.claimPairCode('222222', 'iPad', 5);
    expect(claimed).toMatchObject({ token: expect.stringMatching(/^gppd_[\w-]{43}$/), userId, orgId });
    const token = claimed!.token;
    expect(await accounts.pairing.pairedDevice(token)).toBe(true);
    expect(await accounts.pairing.claimPairCode('222222', 'iPad 2', 5)).toBeNull(); // replayed
    const session = await accounts.members.createSession(userId, orgId, 'iPad', claimed!.deviceId);

    await code('333333');
    clock.now += ACCOUNT_LIMITS.pairCodeTtlMs;
    expect(await accounts.pairing.claimPairCode('333333', 'late', 5)).toBeNull();

    await code('444444');
    for (let i = 0; i < 5; i++) expect(await accounts.pairing.claimPairCode(String(500000 + i), 'guess', 5)).toBeNull();
    expect(await accounts.pairing.claimPairCode('444444', 'right, too late', 5)).toBeNull();

    const [device] = await accounts.pairing.pairedDevices();
    expect(device).toMatchObject({ name: 'iPad', revokedAt: null });
    expect(await accounts.pairing.revokeDevice(device!.id)).toBe(true);
    expect(await accounts.pairing.pairedDevice(token)).toBe(false);
    expect(await accounts.members.session(session.token)).toBeNull(); // the pairing's session ends with it
    expect(await accounts.pairing.pairedDevice('gppd_forged')).toBe(false);
  });

  it('passkey flows: start once, then single use, bound to the browser and the kind, and dead after 5 minutes', async () => {
    const { accounts, clock } = await fresh(driver);
    const begin = () => accounts.passkeys.createFlow({ kind: 'authenticate', address: 'a', deviceName: 'Mac', callbackScheme: null });
    const s1 = (await begin()) as string;
    expect(await accounts.passkeys.startFlow(s1, 'browser-1', 'challenge-1')).toMatchObject({ kind: 'authenticate', deviceName: 'Mac' });
    expect(await accounts.passkeys.startFlow(s1, 'browser-2', 'challenge-2')).toBeNull(); // started once
    expect(await accounts.passkeys.takeFlow('challenge-1', 'browser-2', 'authenticate')).toBeNull(); // another browser
    expect(await accounts.passkeys.takeFlow('challenge-1', 'browser-1', 'register')).toBeNull(); // another kind
    expect(await accounts.passkeys.takeFlow('challenge-1', 'browser-1', 'authenticate')).not.toBeNull();
    expect(await accounts.passkeys.takeFlow('challenge-1', 'browser-1', 'authenticate')).toBeNull(); // replayed

    const s2 = (await begin()) as string;
    await accounts.passkeys.startFlow(s2, 'browser-1', 'challenge-3');
    clock.now += PASSKEY_FLOW.ttlMs;
    expect(await accounts.passkeys.takeFlow('challenge-3', 'browser-1', 'authenticate')).toBeNull(); // expired
    expect(await accounts.passkeys.startFlow((await begin()) as string, 'b', 'c')).not.toBeNull();
    const s3 = (await begin()) as string;
    clock.now += PASSKEY_FLOW.ttlMs;
    expect(await accounts.passkeys.startFlow(s3, 'b', 'c2')).toBeNull(); // expired before it was opened

    for (let i = 0; i < PASSKEY_FLOW.perAddress; i++) expect(await begin()).not.toBe('limit');
    expect(await begin()).toBe('limit');
    clock.now += PASSKEY_FLOW.ttlMs;
    expect(await begin()).not.toBe('limit');
  });

  it('logins: at most 5 per user (ORG-R13), one Google account, only from a valid session; the last is never removed; counters compare-and-set', async () => {
    const { accounts, userId, orgId } = await fresh(driver);
    const { sessionId } = await accounts.members.createSession(userId, orgId, 'Mac');
    const pk = (id: string): NewLogin => ({ provider: 'passkey', passkey: { id, publicKey: 'k', signCount: 3, transports: [] }, name: id });
    for (const id of ['p1', 'p2', 'p3', 'p4']) expect(await accounts.logins.add(userId, sessionId, pk(id))).toMatchObject({ id });
    expect(await accounts.logins.add(userId, sessionId, pk('p5'))).toBe('limit'); // Google + 4 passkeys
    expect(await accounts.logins.add(userId, sessionId, { provider: 'google', subject: 'other', name: null })).toBe('limit');
    expect(await accounts.logins.add(userId, sessionId, pk('p1'))).toMatchObject({ id: 'p1' }); // already hers

    expect(await accounts.passkeys.use('p1', 2, 4)).toBe(false); // the counter moved meanwhile
    expect(await accounts.passkeys.use('p1', 3, 4)).toBe(true);
    expect(await accounts.passkeys.get('p1')).toEqual({ userId, publicKey: 'k', signCount: 4 });

    for (const id of ['p1', 'p2', 'p3', 'p4']) expect(await accounts.logins.remove(userId, 'passkey', id)).toBe('ok');
    expect(await accounts.logins.remove(userId, 'google', 'sub-anna')).toBe('last-login');
    expect(await accounts.logins.remove(userId, 'passkey', 'p1')).toBe('not-found');

    await accounts.members.revokeSession(sessionId);
    expect(await accounts.logins.add(userId, sessionId, pk('late'))).toBe('unauthenticated');
    const bo = (await accounts.members.createLocalUser(orgId, { name: 'Bo', email: null, role: 'user' })) as { id: string };
    const boSession = await accounts.members.createSession(bo.id, orgId, 'Mac');
    expect(await accounts.logins.add(bo.id, boSession.sessionId, { provider: 'google', subject: 'sub-anna', name: null })).toBe('login-taken');
    expect(await accounts.logins.add(userId, boSession.sessionId, pk('x'))).toBe('unauthenticated'); // someone else's session
  });
});

describe('webauthn', () => {
  it('CBOR: definite lengths only, no duplicate keys, nothing left over', () => {
    expect(decodeCbor(new Uint8Array([0xa1, 0x01, 0x02])).value).toEqual(new Map([[1, 2]]));
    expect(decodeCbor(new Uint8Array([0x39, 0x01, 0x00])).value).toBe(-257);
    for (const bad of [[0x9f, 0xff], [0xa2, 0x01, 0x02, 0x01, 0x03], [0x5a, 0, 0, 0, 9, 1], [0xc0, 0x01], [0xf9, 0, 0]]) {
      expect(() => decodeCbor(new Uint8Array(bad)), JSON.stringify(bad)).toThrow();
    }
  });

  it('ECDSA signatures: strict DER to r||s, padded to 32 bytes', () => {
    const r = [0x00, 0x80, ...Array(31).fill(1)]; // 32 bytes with the high bit set: needs a leading zero
    const s = [0x05];
    const der = new Uint8Array([0x30, 2 + r.length + 2 + s.length, 0x02, r.length, ...r, 0x02, s.length, ...s]);
    const raw = derToRaw(der)!;
    expect(raw.length).toBe(64);
    expect([...raw.subarray(0, 32)]).toEqual(r.slice(1));
    expect(raw[63]).toBe(5);
    expect(derToRaw(new Uint8Array([0x30, 6, 0x02, 1, 0x80, 0x02, 1, 1]))).toBeNull(); // negative
    expect(derToRaw(new Uint8Array([0x30, 7, 0x02, 2, 0x00, 0x01, 0x02, 1, 1]))).toBeNull(); // not minimal
    expect(derToRaw(new Uint8Array([0x30, 7, 0x02, 1, 0x01, 0x02, 1, 1, 0]))).toBeNull(); // trailing byte
  });

  it('the RP ID and origins are checked at start: no IP address, no origin off the RP ID, no plain http but localhost', () => {
    expect(() => new Passkeys({ rpId: '127.0.0.1', origins: ['http://127.0.0.1:47800'] })).toThrow(/IP address/);
    expect(() => new Passkeys({ rpId: 'example.org', origins: ['https://evil.org'] })).toThrow(/not on the RP ID/);
    expect(() => new Passkeys({ rpId: 'example.org', origins: ['http://app.example.org'] })).toThrow(/secure context/);
    expect(() => new Passkeys({ rpId: 'example.org', origins: ['https://app.example.org/'] })).toThrow(/not an origin/);
    expect(() => new Passkeys({ rpId: 'example.org', origins: [] })).toThrow();
    expect(new Passkeys({ rpId: 'Example.org', origins: ['https://app.example.org', 'https://example.org'] }).rpId).toBe('example.org');
    expect(new Passkeys({ rpId: 'localhost', origins: ['http://localhost:47800'] }).origins.has('http://localhost:47800')).toBe(true);
  });
});
