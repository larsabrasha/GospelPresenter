// The global tables against a fake clock: expiry, throttling, caps and
// single use, which the HTTP tests cannot wait for. On both Node drivers.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ACCOUNT_LIMITS } from '@gp/core';
import { newDigits, pkceChallenge, sha256 } from '../src/crypto.ts';
import { Accounts, LOGIN_FLOW, migrateGlobal, PASSKEY_FLOW, THROTTLE, type NewLogin } from '../src/global.ts';
import { decodeCbor, derToRaw, Passkeys } from '../src/webauthn.ts';
import { nodeGlobalSql, openSqlite, type NodeDriver } from '@gp/server/node';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

async function fresh(driver: NodeDriver) {
  const clock = { now: 1_000_000 };
  const sql = nodeGlobalSql(openSqlite(':memory:', driver));
  await migrateGlobal(sql);
  const accounts = new Accounts(sql, { now: () => clock.now });
  const setup = await accounts.setup({ name: 'Anna', orgName: 'Lilla Kyrkan' });
  if (setup === 'setup-done') throw new Error('setup');
  // The SuperAdmin links Google through the setup invite.
  const linked = await accounts.signInWithGoogle(google('anna'), await sha256(setup.inviteToken));
  if (typeof linked === 'string') throw new Error(linked);
  return { clock, accounts, ...setup };
}

const google = (sub: string, email: string | null = `${sub}@gmail.com`) => ({ sub: `sub-${sub}`, email, name: sub });

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
  it('setup happens once: a second setup after the SuperAdmin linked Google creates nothing', async () => {
    const { accounts } = await fresh(driver);
    expect(await accounts.setupDone()).toBe(true);
    expect(await accounts.setup({ name: 'Eve', orgName: 'Evil' })).toBe('setup-done');
    expect(await accounts.sql.all('SELECT name, email FROM users')).toEqual([{ name: 'Anna', email: 'anna@gmail.com' }]); // filled from Google
    expect(await accounts.sql.all('SELECT count(*) AS n FROM orgs')).toEqual([{ n: 1 }]);
  });

  it('a setup left before signing in can be done again: same SuperAdmin and organisation, only the newest invite works', async () => {
    const sql = nodeGlobalSql(openSqlite(':memory:', driver));
    await migrateGlobal(sql);
    const accounts = new Accounts(sql);
    const first = await accounts.setup({ name: 'Anna', orgName: 'Kyrkan' });
    if (first === 'setup-done') throw new Error('setup');
    expect(await accounts.setupDone()).toBe(false);
    const again = await accounts.setup({ name: 'Anna Berg', orgName: 'Lilla Kyrkan' });
    if (again === 'setup-done') throw new Error('setup');
    expect(again).toMatchObject({ userId: first.userId, orgId: first.orgId });
    expect(await accounts.invite(first.inviteToken)).toEqual({ state: 'invalid' });
    expect(await accounts.signInWithGoogle(google('anna'), await sha256(again.inviteToken))).toEqual({ userId: first.userId, orgId: first.orgId });
    expect(await accounts.sql.all('SELECT name FROM orgs')).toEqual([{ name: 'Lilla Kyrkan' }]);
    expect(await accounts.setup({ name: 'Eve', orgName: 'Evil' })).toBe('setup-done');
  });

  it('Google sign-in: by the linked sub only, never by email; no invite and no link is refused (AUTH-R4)', async () => {
    const { accounts, userId, orgId } = await fresh(driver);
    expect(await accounts.signInWithGoogle(google('anna', 'new-address@gmail.com'), null)).toEqual({ userId, orgId }); // email changed at Google
    expect(await accounts.signInWithGoogle(google('mallory', 'anna@gmail.com'), null)).toBe('not-linked'); // same email, other account
    expect(await accounts.signInWithGoogle(google('nobody'), null)).toBe('not-linked');
  });

  it('an invite links one Google account; one already linked to someone else is refused and the invite is kept', async () => {
    const { accounts, orgId } = await fresh(driver);
    const bo = await accounts.createUser(orgId, { name: 'Bo', email: 'bo@x.se', role: 'user' });
    if (typeof bo === 'string') throw new Error(bo);
    expect(await accounts.signInWithGoogle(google('anna'), await sha256(bo.inviteToken))).toBe('login-taken');
    expect(await accounts.invite(bo.inviteToken)).toMatchObject({ state: 'valid' });
    expect(await accounts.signInWithGoogle(google('bo'), await sha256(bo.inviteToken))).toEqual({ userId: bo.id, orgId });
    expect(await accounts.sql.all('SELECT email FROM users WHERE id = ?', [bo.id])).toEqual([{ email: 'bo@x.se' }]); // kept, not overwritten
    expect(await accounts.signInWithGoogle(google('bo'), null)).toEqual({ userId: bo.id, orgId });
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

  it('an invite is valid for 7 days and once; using it replaces the Google account and revokes other sessions', async () => {
    const { accounts, clock, orgId } = await fresh(driver);
    const bo = await accounts.createUser(orgId, { name: 'Bo', email: 'bo@x.se', role: 'user' });
    if (typeof bo === 'string') throw new Error(bo);
    expect(await accounts.invite(bo.inviteToken)).toEqual({ state: 'valid', name: 'Bo', orgName: 'Lilla Kyrkan', email: 'bo@x.se' });

    clock.now += ACCOUNT_LIMITS.inviteTtlMs;
    expect(await accounts.invite(bo.inviteToken)).toEqual({ state: 'expired' });
    expect(await accounts.signInWithGoogle(google('bo'), await sha256(bo.inviteToken))).toBe('invite-expired');

    const second = await accounts.createInvite(bo.id, orgId);
    if (second === 'limit') throw new Error('limit');
    expect(await accounts.signInWithGoogle(google('bo'), await sha256(second))).toEqual({ userId: bo.id, orgId });
    const old = await accounts.createSession(bo.id, orgId, 'old phone');

    // A new invite is the reset: Bo's new Google account replaces the old one, and his sessions end.
    const third = await accounts.createInvite(bo.id, orgId);
    if (third === 'limit') throw new Error('limit');
    expect(await accounts.signInWithGoogle(google('bo-new'), await sha256(third))).toEqual({ userId: bo.id, orgId });
    expect(await accounts.session(old.token)).toBeNull();
    expect(await accounts.signInWithGoogle(google('bo'), null)).toBe('not-linked');
    expect(await accounts.signInWithGoogle(google('bo-new'), null)).toEqual({ userId: bo.id, orgId });
    expect(await accounts.invite(third)).toEqual({ state: 'invalid' });
    expect(await accounts.signInWithGoogle(google('bo-new'), await sha256(third))).toBe('invite-invalid'); // replayed
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
    expect(await accounts.createUser(orgId, { name: 'Anna 2', email: 'anna@gmail.com', role: 'user' })).toBe('email-taken');
  });

  it('deleting a user takes their logins, sessions, invites and membership', async () => {
    const { accounts, orgId } = await fresh(driver);
    const bo = await accounts.createUser(orgId, { name: 'Bo', email: 'bo@x.se', role: 'admin' });
    if (typeof bo === 'string') throw new Error(bo);
    const s = await accounts.createSession(bo.id, orgId, 'x');
    const invite = await accounts.createInvite(bo.id, orgId);
    expect(await accounts.signInWithGoogle(google('bo'), await sha256(invite as string))).toMatchObject({ userId: bo.id });
    await accounts.deleteUser(bo.id);
    expect(await accounts.signInWithGoogle(google('bo'), null)).toBe('not-linked');
    expect(await accounts.session(s.token)).toBeNull();
    expect(await accounts.invite(bo.inviteToken)).toEqual({ state: 'invalid' });
    expect(await accounts.member(bo.id, orgId)).toBeNull();
  });

  it('throttling: 20 failures lock an address for 15 minutes; a failure after the window starts counting again', async () => {
    const { accounts, clock } = await fresh(driver);
    const p = THROTTLE.address;
    for (let i = 0; i < p.free - 1; i++) await accounts.fail('address:a', p);
    expect(await accounts.lockedUntil(['address:a'])).toBe(0);
    await accounts.fail('address:a', p);
    expect(await accounts.lockedUntil(['address:a', 'address:b'])).toBe(clock.now + 15 * MIN);
    clock.now += 15 * MIN + 1;
    expect(await accounts.lockedUntil(['address:a'])).toBe(0);
    await accounts.fail('address:a', p);
    expect(await accounts.lockedUntil(['address:a'])).toBe(0);
    await accounts.clearThrottle('address:a');
    expect(await accounts.sql.all('SELECT * FROM auth_throttle')).toEqual([]);
  });

  it('a sign-in flow starts once, in one browser, is taken once, and dies after 10 minutes', async () => {
    const { accounts, clock } = await fresh(driver);
    const flow = { address: '10.0.0.1', inviteToken: null, deviceName: 'Mac', callbackScheme: 'gospelpresenter' };
    const state = (await accounts.createFlow(flow)) as string;
    expect(state).toMatch(/^[\w-]{43}$/);
    const started = await accounts.startFlow(state, 'browser-a');
    expect(started?.verifier).toMatch(/^[\w-]{43}$/);
    expect(await accounts.startFlow(state, 'browser-b')).toBeNull(); // started already
    expect(await accounts.takeFlow(state, 'browser-b')).toBeNull(); // another browser
    expect(await accounts.takeFlow('forged', 'browser-a')).toBeNull();
    expect(await accounts.takeFlow(state, 'browser-a')).toMatchObject({ nonce: started!.nonce, verifier: started!.verifier, callbackScheme: 'gospelpresenter' });
    expect(await accounts.takeFlow(state, 'browser-a')).toBeNull(); // replayed

    const late = (await accounts.createFlow(flow)) as string;
    await accounts.startFlow(late, 'browser-a');
    clock.now += LOGIN_FLOW.ttlMs;
    expect(await accounts.takeFlow(late, 'browser-a')).toBeNull();
  });

  it('at most 20 open sign-in flows per address; a web handoff is collected once', async () => {
    const { accounts, userId, orgId } = await fresh(driver);
    const flow = { address: '10.0.0.2', inviteToken: null, deviceName: '', callbackScheme: null };
    const states = [];
    for (let i = 0; i < LOGIN_FLOW.perAddress; i++) states.push(await accounts.createFlow(flow));
    expect(await accounts.createFlow(flow)).toBe('limit');
    expect(await accounts.createFlow({ ...flow, address: '10.0.0.3' })).toMatch(/^[\w-]{43}$/);

    await accounts.setHandoff(states[0] as string, 'handoff-secret', userId, orgId);
    expect(await accounts.takeHandoff('wrong')).toBeNull();
    expect(await accounts.takeHandoff('handoff-secret')).toEqual({ userId, orgId });
    expect(await accounts.takeHandoff('handoff-secret')).toBeNull();
  });

  it('pairing: one code at a time, single use, 10 minutes, dead after 5 wrong guesses', async () => {
    const { accounts, clock, userId, orgId } = await fresh(driver);
    const code = (c: string) => accounts.newPairCode(c, ACCOUNT_LIMITS.pairCodeTtlMs, userId, orgId);
    await code('111111');
    await code('222222'); // replaces the first
    expect(await accounts.claimPairCode('111111', 'iPad', 5)).toBeNull();
    const claimed = await accounts.claimPairCode('222222', 'iPad', 5);
    expect(claimed).toMatchObject({ token: expect.stringMatching(/^gppd_[\w-]{43}$/), userId, orgId });
    const token = claimed!.token;
    expect(await accounts.pairedDevice(token)).toBe(true);
    expect(await accounts.claimPairCode('222222', 'iPad 2', 5)).toBeNull(); // replayed
    const session = await accounts.createSession(userId, orgId, 'iPad', claimed!.deviceId);

    await code('333333');
    clock.now += ACCOUNT_LIMITS.pairCodeTtlMs;
    expect(await accounts.claimPairCode('333333', 'late', 5)).toBeNull();

    await code('444444');
    for (let i = 0; i < 5; i++) expect(await accounts.claimPairCode(String(500000 + i), 'guess', 5)).toBeNull();
    expect(await accounts.claimPairCode('444444', 'right, too late', 5)).toBeNull();

    const [device] = await accounts.pairedDevices();
    expect(device).toMatchObject({ name: 'iPad', revokedAt: null });
    expect(await accounts.revokeDevice(device!.id)).toBe(true);
    expect(await accounts.pairedDevice(token)).toBe(false);
    expect(await accounts.session(session.token)).toBeNull(); // the pairing's session ends with it
    expect(await accounts.pairedDevice('gppd_forged')).toBe(false);
  });

  it('passkey flows: start once, then single use, bound to the browser and the kind, and dead after 5 minutes', async () => {
    const { accounts, clock } = await fresh(driver);
    const begin = () => accounts.createPasskeyFlow({ kind: 'authenticate', address: 'a', deviceName: 'Mac', callbackScheme: null });
    const s1 = (await begin()) as string;
    expect(await accounts.startPasskeyFlow(s1, 'browser-1', 'challenge-1')).toMatchObject({ kind: 'authenticate', deviceName: 'Mac' });
    expect(await accounts.startPasskeyFlow(s1, 'browser-2', 'challenge-2')).toBeNull(); // started once
    expect(await accounts.takePasskeyFlow('challenge-1', 'browser-2', 'authenticate')).toBeNull(); // another browser
    expect(await accounts.takePasskeyFlow('challenge-1', 'browser-1', 'register')).toBeNull(); // another kind
    expect(await accounts.takePasskeyFlow('challenge-1', 'browser-1', 'authenticate')).not.toBeNull();
    expect(await accounts.takePasskeyFlow('challenge-1', 'browser-1', 'authenticate')).toBeNull(); // replayed

    const s2 = (await begin()) as string;
    await accounts.startPasskeyFlow(s2, 'browser-1', 'challenge-3');
    clock.now += PASSKEY_FLOW.ttlMs;
    expect(await accounts.takePasskeyFlow('challenge-3', 'browser-1', 'authenticate')).toBeNull(); // expired
    expect(await accounts.startPasskeyFlow((await begin()) as string, 'b', 'c')).not.toBeNull();
    const s3 = (await begin()) as string;
    clock.now += PASSKEY_FLOW.ttlMs;
    expect(await accounts.startPasskeyFlow(s3, 'b', 'c2')).toBeNull(); // expired before it was opened

    for (let i = 0; i < PASSKEY_FLOW.perAddress; i++) expect(await begin()).not.toBe('limit');
    expect(await begin()).toBe('limit');
    clock.now += PASSKEY_FLOW.ttlMs;
    expect(await begin()).not.toBe('limit');
  });

  it('logins: at most 5 per user (ORG-R13), one Google account, only from a valid session; the last is never removed; counters compare-and-set', async () => {
    const { accounts, userId, orgId } = await fresh(driver);
    const { sessionId } = await accounts.createSession(userId, orgId, 'Mac');
    const pk = (id: string): NewLogin => ({ provider: 'passkey', passkey: { id, publicKey: 'k', signCount: 3, transports: [] }, name: id });
    for (const id of ['p1', 'p2', 'p3', 'p4']) expect(await accounts.addLogin(userId, sessionId, pk(id))).toMatchObject({ id });
    expect(await accounts.addLogin(userId, sessionId, pk('p5'))).toBe('limit'); // Google + 4 passkeys
    expect(await accounts.addLogin(userId, sessionId, { provider: 'google', subject: 'other', name: null })).toBe('limit');
    expect(await accounts.addLogin(userId, sessionId, pk('p1'))).toMatchObject({ id: 'p1' }); // already hers

    expect(await accounts.usePasskey('p1', 2, 4)).toBe(false); // the counter moved meanwhile
    expect(await accounts.usePasskey('p1', 3, 4)).toBe(true);
    expect(await accounts.passkey('p1')).toEqual({ userId, publicKey: 'k', signCount: 4 });

    for (const id of ['p1', 'p2', 'p3', 'p4']) expect(await accounts.removeLogin(userId, 'passkey', id)).toBe('ok');
    expect(await accounts.removeLogin(userId, 'google', 'sub-anna')).toBe('last-login');
    expect(await accounts.removeLogin(userId, 'passkey', 'p1')).toBe('not-found');

    await accounts.revokeSession(sessionId);
    expect(await accounts.addLogin(userId, sessionId, pk('late'))).toBe('unauthenticated');
    const bo = await accounts.createUser(orgId, { name: 'Bo', email: 'bo@x.se', role: 'user' });
    if (typeof bo === 'string') throw new Error(bo);
    const boSession = await accounts.createSession(bo.id, orgId, 'Mac');
    expect(await accounts.addLogin(bo.id, boSession.sessionId, { provider: 'google', subject: 'sub-anna', name: null })).toBe('login-taken');
    expect(await accounts.addLogin(userId, boSession.sessionId, pk('x'))).toBe('unauthenticated'); // someone else's session
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
