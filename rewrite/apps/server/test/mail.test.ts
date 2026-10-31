// E-mail (GAPS.md "E-post", decided on 2026-10-31): an admin mails an invite, and "Glömt hur du loggar in?" mails a
// new one. The routes run on Node with a mailer that keeps what it is given; Resend's API is faked by `fetch`.
import { describe, expect, it } from 'vitest';
import { Accounts, migrateGlobal, THROTTLE } from '../src/global/index.ts';
import { authRoutes } from '../src/auth/index.ts';
import { inviteLink, mailConfigFrom, resendMailer, type Mail } from '../src/mail.ts';
import { nodeGlobalSql, openSqlite } from '../src/node.ts';

const APP = 'https://app.example.org';

async function server(opts: { mail?: boolean; failing?: boolean } = {}) {
  const sql = nodeGlobalSql(openSqlite(':memory:', 'node:sqlite'));
  await migrateGlobal(sql);
  const accounts = new Accounts(sql);
  const sent: Mail[] = [];
  const mailer = {
    send: async (m: Mail) => {
      if (opts.failing) throw new Error('Resend is down');
      sent.push(m);
    },
  };
  const app = authRoutes({ accounts, setupToken: null, clientAddress: () => '10.0.0.1', google: null, passkeys: null, mail: opts.mail === false ? null : { mailer, appUrl: APP } });
  const setup = await accounts.members.setup({ name: 'Anna', orgName: 'Lilla Kyrkan' });
  if (setup === 'setup-done') throw new Error('setup');
  const admin = await accounts.members.createSession(setup.userId, setup.orgId, 'test');
  const bo = await accounts.members.createUser(setup.orgId, { name: 'Bo', email: 'bo@x.se', role: 'user' });
  const nils = await accounts.members.createUser(setup.orgId, { name: 'Nils', email: '', role: 'user' });
  if (typeof bo === 'string' || typeof nils === 'string') throw new Error('createUser');
  const call = async (method: string, path: string, body?: unknown, token: string | null = admin.token) => {
    const res = await app.request(path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  /** Lets the work after an answer finish (Node runs it unawaited). */
  const settle = () => new Promise((r) => setTimeout(r, 20));
  return { accounts, sent, call, settle, bo: bo.id, nils: nils.id };
}

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

describe('an admin mailing an invite', () => {
  it('mails the user a new invite link to the app address', async () => {
    const s = await server();

    const r = await s.call('POST', `/api/users/${s.bo}/invites/email`);

    expect(r.status).toBe(200);
    expect(s.sent).toHaveLength(1);
    expect(s.sent[0]!.to).toBe('bo@x.se');
    expect(s.sent[0]!.subject).toBe('Du är inbjuden till Lilla Kyrkan i Gospel Presenter');
    expect(s.sent[0]!.text).toContain(inviteLink(APP, String(r.body.inviteToken)));
  });

  it('mails a link that is a valid invite', async () => {
    const s = await server();

    const r = await s.call('POST', `/api/users/${s.bo}/invites/email`);

    expect((await s.accounts.members.invite(String(r.body.inviteToken))).state).toBe('valid');
  });

  it('refuses a user without an e-mail address', async () => {
    const s = await server();

    expect(await s.call('POST', `/api/users/${s.nils}/invites/email`)).toEqual({ status: 409, body: { error: 'no-email' } });
  });

  it('says when the mail could not be sent', async () => {
    const s = await server({ failing: true });

    expect(await s.call('POST', `/api/users/${s.bo}/invites/email`)).toEqual({ status: 503, body: { error: 'mail-failed' } });
  });

  it('refuses when the server cannot mail', async () => {
    const s = await server({ mail: false });

    expect((await s.call('POST', `/api/users/${s.bo}/invites/email`)).body).toEqual({ error: 'mail-disabled' });
  });

  it('refuses someone who is not signed in', async () => {
    const s = await server();

    expect((await s.call('POST', `/api/users/${s.bo}/invites/email`, undefined, null)).status).toBe(401);
  });
});

describe('Glömt hur du loggar in?', () => {
  it('mails a new invite to the user with the address, whatever its case', async () => {
    const s = await server();

    const r = await s.call('POST', '/api/auth/recover', { email: ' BO@x.se ' }, null);
    await s.settle();

    expect(r).toEqual({ status: 200, body: { ok: true } });
    expect(s.sent.map((m) => [m.to, m.subject])).toEqual([['bo@x.se', 'Logga in i Gospel Presenter igen']]);
  });

  it('mails a link that is a valid invite to the app address', async () => {
    const s = await server();

    await s.call('POST', '/api/auth/recover', { email: 'bo@x.se' }, null);
    await s.settle();

    const token = decodeURIComponent(/\/invite#(\S+)/.exec(s.sent[0]!.text)![1]!);
    expect(s.sent[0]!.text).toContain(`${APP}/invite#`);
    expect((await s.accounts.members.invite(token)).state).toBe('valid');
  });

  it('answers the same for an address without an account, and mails nothing', async () => {
    const s = await server();

    const r = await s.call('POST', '/api/auth/recover', { email: 'ingen@x.se' }, null);
    await s.settle();

    expect([r, s.sent]).toEqual([{ status: 200, body: { ok: true } }, []]);
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

describe("the mail's language", () => {
  it('is English for an invite from an admin whose page is in English', async () => {
    const s = await server();

    await s.call('POST', `/api/users/${s.bo}/invites/email`, { language: 'en' });

    expect(s.sent[0]!.subject).toBe('You are invited to Lilla Kyrkan in Gospel Presenter');
  });

  it('is English for a new invite asked for on a sign-in page in English', async () => {
    const s = await server();

    await s.call('POST', '/api/auth/recover', { email: 'bo@x.se', language: 'en' }, null);
    await s.settle();

    expect(s.sent[0]!.text).toMatch(/^Hi Bo!/);
  });

  it('is Swedish for a language the app does not have', async () => {
    const s = await server();

    await s.call('POST', `/api/users/${s.bo}/invites/email`, { language: 'de' });

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
