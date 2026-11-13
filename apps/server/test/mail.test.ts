// E-mail (GAPS.md "E-post", decided on 2026-10-31; docs/accounts-and-roles.md): an admin's invitation goes by mail, a
// Superadmin mails a reset link, "Glömt hur du loggar in?" mails one to a confirmed address, and a new address gets a
// link that confirms it. The routes run on Node with a mailer that keeps what it is given; Resend's API is faked by `fetch`.
import { describe, expect, it } from 'vitest';
import { ACCOUNT_LIMITS } from '@gp/core';
import { Accounts, migrateGlobal, THROTTLE } from '../src/global/index.ts';
import { authRoutes } from '../src/auth/index.ts';
import { confirmEmailLink, inviteLink, mailConfigFrom, resendMailer, type Mail } from '../src/mail.ts';
import { nodeGlobalSql, openSqlite } from '../src/node.ts';

const APP = 'https://app.example.org';

async function server(opts: { mail?: boolean; failing?: boolean } = {}) {
  const sql = nodeGlobalSql(openSqlite(':memory:', 'node:sqlite'));
  await migrateGlobal(sql);
  const accounts = new Accounts(sql);
  const sent: Mail[] = [];
  let failNext = false;
  const mailer = {
    send: async (m: Mail) => {
      if (opts.failing || failNext) throw new Error('Resend is down');
      sent.push(m);
    },
  };
  const app = authRoutes({ accounts, setupToken: null, clientAddress: () => '10.0.0.1', google: null, passkeys: null, mail: opts.mail === false ? null : { mailer, appUrl: APP } });
  const setup = await accounts.members.setup({ name: 'Anna', orgName: 'Lilla Kyrkan' });
  if (setup === 'setup-done') throw new Error('setup');
  const admin = await accounts.members.createSession(setup.userId, setup.orgId, 'test');
  const superAdmin = await accounts.members.createSession(setup.userId, setup.orgId, 'test', null, undefined, Date.now() + ACCOUNT_LIMITS.superModeMs);
  const bo = (await accounts.members.createLocalUser(setup.orgId, { name: 'Bo', email: 'bo@x.se', role: 'user' })) as { id: string };
  await sql.run('UPDATE users SET email_confirmed = 1 WHERE id = ?', [bo.id]);
  const nils = (await accounts.members.createLocalUser(setup.orgId, { name: 'Nils', email: null, role: 'user' })) as { id: string };
  const boSession = await accounts.members.createSession(bo.id, setup.orgId, 'test');
  const call = async (method: string, path: string, body?: unknown, token: string | null = admin.token) => {
    const res = await app.request(path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  /** Lets the work after an answer finish (Node runs it unawaited). */
  const settle = () => new Promise((r) => setTimeout(r, 20));
  return { accounts, sent, call, settle, bo: bo.id, nils: nils.id, superAdmin: superAdmin.token, boToken: boSession.token, orgId: setup.orgId, failNext: () => void (failNext = true) };
}

/** The token of the link in a mail, after `path#`. */
const tokenIn = (m: Mail, path: string) => decodeURIComponent(new RegExp(`/${path}#(\\S+)`).exec(m.text)![1]!);

describe('the server says whether it can mail', () => {
  it('says so in the auth state when mail is configured, and not otherwise', async () => {
    const on = await server();
    const off = await server({ mail: false });

    expect([(await on.call('GET', '/api/auth/state')).body.mail, (await off.call('GET', '/api/auth/state')).body.mail]).toEqual([true, false]);
  });

  it('needs a key, a sender and the app address', () => {
    expect([mailConfigFrom({ apiKey: 'k', from: 'f' }), mailConfigFrom({ apiKey: 'k', from: 'f', appUrl: APP }) !== null]).toEqual([null, true]);
  });
});

describe('an admin inviting an address', () => {
  it('mails the link, and does not answer it: only the mail has it', async () => {
    const s = await server();

    const r = await s.call('POST', '/api/invitations', { email: 'Cy@X.se', role: 'user' });

    expect(r).toEqual({ status: 200, body: { id: expect.any(String), mailed: true } });
    expect(s.sent.map((m) => [m.to, m.subject])).toEqual([['cy@x.se', 'Du är inbjuden till Lilla Kyrkan i Gospel Presenter']]);
  });

  it('mails a link to the app address that is a valid invitation', async () => {
    const s = await server();

    await s.call('POST', '/api/invitations', { email: 'cy@x.se', role: 'user' });

    expect(s.sent[0]!.text).toContain(`${APP}/invite#`);
    expect(await s.accounts.invitations.lookup(tokenIn(s.sent[0]!, 'invite'))).toEqual({ state: 'valid', kind: 'join', orgName: 'Lilla Kyrkan', email: 'cy@x.se' });
  });

  it('withdraws the invitation when the mail could not be sent', async () => {
    const s = await server({ failing: true });

    expect(await s.call('POST', '/api/invitations', { email: 'cy@x.se', role: 'user' })).toEqual({ status: 503, body: { error: 'mail-failed' } });
    expect(await s.accounts.invitations.list(s.orgId)).toEqual([]);
  });

  it('keeps an earlier invitation to the address when the new one could not be mailed', async () => {
    const s = await server();
    await s.call('POST', '/api/invitations', { email: 'cy@x.se', role: 'user' });
    const first = tokenIn(s.sent[0]!, 'invite');
    s.failNext();

    expect((await s.call('POST', '/api/invitations', { email: 'cy@x.se', role: 'user' })).status).toBe(503);
    expect(await s.accounts.invitations.lookup(first)).toMatchObject({ state: 'valid' });
  });

  it('replaces an earlier invitation to the address once the new one is mailed', async () => {
    const s = await server();
    await s.call('POST', '/api/invitations', { email: 'cy@x.se', role: 'user' });
    await s.call('POST', '/api/invitations', { email: 'cy@x.se', role: 'admin' });

    expect([await s.accounts.invitations.lookup(tokenIn(s.sent[0]!, 'invite')), (await s.accounts.invitations.list(s.orgId)).map((i) => i.role)]).toEqual([null, ['admin']]); // withdrawn: no such invitation any more
  });

  it('answers the link itself where the server cannot mail', async () => {
    const s = await server({ mail: false });

    const r = await s.call('POST', '/api/invitations', { email: 'cy@x.se', role: 'user' });

    expect(r.body).toEqual({ id: expect.any(String), mailed: false, inviteToken: expect.stringMatching(/^gpin_/) });
  });
});

describe('a Superadmin mailing a reset link', () => {
  it('mails the user a link to the app address that replaces their logins', async () => {
    const s = await server();

    const r = await s.call('POST', `/api/users/${s.bo}/invites/email`, undefined, s.superAdmin);

    expect(r.status).toBe(200);
    expect(s.sent.map((m) => [m.to, m.subject])).toEqual([['bo@x.se', 'Ett nytt sätt att logga in i Gospel Presenter']]);
    expect(s.sent[0]!.text).toContain(inviteLink(APP, String(r.body.inviteToken)));
    expect(await s.accounts.members.invite(String(r.body.inviteToken))).toMatchObject({ state: 'valid', kind: 'reset' });
  });

  it('is refused an Admin', async () => {
    const s = await server();

    expect(await s.call('POST', `/api/users/${s.bo}/invites/email`)).toEqual({ status: 403, body: { error: 'super-admin-only' } });
  });

  it('refuses a user without an e-mail address', async () => {
    const s = await server();

    expect(await s.call('POST', `/api/users/${s.nils}/invites/email`, undefined, s.superAdmin)).toEqual({ status: 409, body: { error: 'no-email' } });
  });

  it('says when the mail could not be sent', async () => {
    const s = await server({ failing: true });

    expect(await s.call('POST', `/api/users/${s.bo}/invites/email`, undefined, s.superAdmin)).toEqual({ status: 503, body: { error: 'mail-failed' } });
  });

  it('refuses when the server cannot mail', async () => {
    const s = await server({ mail: false });

    expect((await s.call('POST', `/api/users/${s.bo}/invites/email`, undefined, s.superAdmin)).body).toEqual({ error: 'mail-disabled' });
  });

  it('refuses someone who is not signed in', async () => {
    const s = await server();

    expect((await s.call('POST', `/api/users/${s.bo}/invites/email`, undefined, null)).status).toBe(401);
  });
});

describe('Glömt hur du loggar in?', () => {
  it('mails a reset link to the user who confirmed the address, whatever its case', async () => {
    const s = await server();

    const r = await s.call('POST', '/api/auth/recover', { email: ' BO@x.se ' }, null);
    await s.settle();

    expect(r).toEqual({ status: 200, body: { ok: true } });
    expect(s.sent.map((m) => [m.to, m.subject])).toEqual([['bo@x.se', 'Logga in i Gospel Presenter igen']]);
    expect((await s.accounts.members.invite(tokenIn(s.sent[0]!, 'invite'))).state).toBe('valid');
  });

  it('answers the same for an address without an account, or not confirmed, and mails nothing', async () => {
    const s = await server();
    await s.accounts.members.updateUser(s.nils, { email: 'nils@x.se' });

    const none = await s.call('POST', '/api/auth/recover', { email: 'ingen@x.se' }, null);
    const unconfirmed = await s.call('POST', '/api/auth/recover', { email: 'nils@x.se' }, null);
    await s.settle();

    expect([none, unconfirmed, s.sent]).toEqual([{ status: 200, body: { ok: true } }, { status: 200, body: { ok: true } }, []]);
  });

  it('stops asking for one address after five asks in an hour', async () => {
    const s = await server();
    for (let i = 0; i < THROTTLE.recover.free; i++) await s.call('POST', '/api/auth/recover', { email: 'bo@x.se' }, null);

    const r = await s.call('POST', '/api/auth/recover', { email: 'bo@x.se' }, null);

    expect(r.status).toBe(429);
  });

  it('refuses when the server cannot mail', async () => {
    const s = await server({ mail: false });

    expect(await s.call('POST', '/api/auth/recover', { email: 'bo@x.se' }, null)).toEqual({ status: 503, body: { error: 'mail-disabled' } });
  });
});

describe('a new address of your own', () => {
  it('mails it a link, and the address is yours, confirmed, once the link is opened', async () => {
    const s = await server();

    const r = await s.call('POST', '/api/auth/email', { email: 'Bo@Ny.se' }, s.boToken);
    await s.settle();
    const unchanged = await s.call('GET', '/api/auth/me', undefined, s.boToken);
    const confirmed = await s.call('POST', '/api/auth/email/confirm', { token: tokenIn(s.sent[0]!, 'confirm-email') }, null);

    expect(r).toEqual({ status: 200, body: { sent: true } });
    expect(unchanged.body.email).toBe('bo@x.se');
    expect(s.sent[0]!.text).toContain(confirmEmailLink(APP, tokenIn(s.sent[0]!, 'confirm-email')));
    expect(confirmed).toEqual({ status: 200, body: { ok: true } });
    expect((await s.call('GET', '/api/auth/me', undefined, s.boToken)).body).toMatchObject({ email: 'bo@ny.se', emailConfirmed: true });
  });

  it("answers the same for another account's confirmed address, whose owner is told someone tried", async () => {
    const s = await server();
    await s.accounts.members.updateUser(s.nils, { email: 'nils@x.se' });
    const nils = await s.accounts.members.createSession(s.nils, s.orgId, 'test');

    const r = await s.call('POST', '/api/auth/email', { email: 'bo@x.se' }, nils.token);
    await s.settle();

    expect(r).toEqual({ status: 200, body: { sent: true } });
    expect(s.sent.map((m) => [m.to, m.subject])).toEqual([['bo@x.se', 'Din e-postadress i Gospel Presenter']]);
    expect(s.sent[0]!.text).not.toContain('confirm-email');
    expect((await s.call('GET', '/api/auth/me', undefined, nils.token)).body.email).toBe('nils@x.se');
  });

  it('stops after five asks in an hour for one address', async () => {
    const s = await server();
    for (let i = 0; i < THROTTLE.recover.free; i++) await s.call('POST', '/api/auth/email', { email: 'bo@ny.se' }, s.boToken);

    expect((await s.call('POST', '/api/auth/email', { email: 'bo@ny.se' }, s.boToken)).status).toBe(429);
  });

  it('refuses a link opened twice', async () => {
    const s = await server();
    await s.call('POST', '/api/auth/email', { email: 'bo@ny.se' }, s.boToken);
    await s.settle();
    const token = tokenIn(s.sent[0]!, 'confirm-email');
    await s.call('POST', '/api/auth/email/confirm', { token }, null);

    expect(await s.call('POST', '/api/auth/email/confirm', { token }, null)).toEqual({ status: 400, body: { error: 'invite-invalid' } });
  });
});

describe("the mail's language", () => {
  it('is English for an invitation from an admin whose page is in English', async () => {
    const s = await server();

    await s.call('POST', '/api/invitations', { email: 'cy@x.se', role: 'user', language: 'en' });

    expect(s.sent[0]!.subject).toBe('You are invited to Lilla Kyrkan in Gospel Presenter');
  });

  it('is English for a reset link asked for on a sign-in page in English', async () => {
    const s = await server();

    await s.call('POST', '/api/auth/recover', { email: 'bo@x.se', language: 'en' }, null);
    await s.settle();

    expect(s.sent[0]!.text).toMatch(/^Hi Bo!/);
  });

  it('is Swedish for a language the app does not have', async () => {
    const s = await server();

    await s.call('POST', '/api/invitations', { email: 'cy@x.se', role: 'user', language: 'de' });

    expect(s.sent[0]!.subject).toBe('Du är inbjuden till Lilla Kyrkan i Gospel Presenter');
  });
});

describe('sending through Resend', () => {
  it('posts the mail to Resend with the key, from the sender', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const mailer = resendMailer({
      apiKey: 're_key',
      from: 'Gospel Presenter <noreply@example.org>',
      fetch: (async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return new Response('{"id":"1"}', { status: 200 });
      }) as typeof fetch,
    });

    await mailer.send({ to: 'bo@x.se', subject: 'Ämne', text: 'Text' });

    expect(calls[0]!.url).toBe('https://api.resend.com/emails');
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer re_key');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ from: 'Gospel Presenter <noreply@example.org>', to: ['bo@x.se'], subject: 'Ämne', text: 'Text' });
  });

  it('throws when Resend answers with an error', async () => {
    const mailer = resendMailer({ apiKey: 'k', from: 'f', fetch: (async () => new Response('bad domain', { status: 422 })) as unknown as typeof fetch });

    await expect(mailer.send({ to: 'bo@x.se', subject: 's', text: 't' })).rejects.toThrow('Resend answered 422: bad domain');
  });
});
