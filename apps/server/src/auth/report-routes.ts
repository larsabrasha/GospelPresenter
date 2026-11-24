// "Rapportera fel" (docs/bug-reports.md): anyone signed in sends a report and talks with the Superadmin about it in its
// thread; the Superadmin reads them all, answers, marks them done and deletes them. Nothing here takes anything
// without a session.
import type { Hono } from 'hono';
import { bugReportDoneRequest, bugReportMessageRequest, bugReportSchema } from '@gp/core';
import { bugReplyMail, myReportLink } from '../mail.ts';
import type { Caller } from './caller.ts';
import { THROTTLE } from '../global/index.ts';
import { body, fail, type AuthKit } from './kit.ts';

export function reportRoutes(app: Hono, kit: AuthKit) {
  const { deps, accounts, withCaller, inBackground, log, tooMany } = kit;
  /** The caller as the server knows them now: name, e-mail and organisation. */
  const who = (caller: Caller) => accounts.members.me({ sessionId: caller.sessionId, userId: caller.ctx.userId, orgId: caller.orgId, role: caller.ctx.role });

  app.post(
    '/api/reports',
    withCaller(null, async (c, caller) => {
      const a = await body(c, bugReportSchema);
      if (!a) return fail(c, 400, 'invalid-request');
      const locked = await accounts.throttle.count([`report:${caller.ctx.userId}`], THROTTLE.report);
      if (locked) return tooMany(locked);
      const me = await who(caller);
      if (!me) return fail(c, 404, 'not-found');
      const id = crypto.randomUUID();
      const reporter = { userId: me.userId, userName: me.name, userEmail: me.email, role: me.role, orgId: me.orgId, orgName: me.orgName };
      await accounts.bugReports.add({ ...a, id, createdAt: accounts.now(), reporter });
      log({ event: 'bug-report', id, orgId: me.orgId, userId: me.userId });
      return c.json({ id });
    }),
  );

  // The one who reported: their own reports, how many answers wait unread, one with its thread, and their answer.
  app.get(
    '/api/my-reports',
    withCaller(null, async (c, caller) => c.json(await accounts.bugReports.listMine(caller.ctx.userId))),
  );

  app.get(
    '/api/my-reports/unread',
    withCaller(null, async (c, caller) => c.json({ unread: await accounts.bugReports.unreadMine(caller.ctx.userId) })),
  );

  app.get(
    '/api/my-reports/:id',
    withCaller(null, async (c, caller) => {
      const r = await accounts.bugReports.getMine(c.req.param('id')!, caller.ctx.userId);
      return r ? c.json(r) : fail(c, 404, 'not-found');
    }),
  );

  app.post(
    '/api/my-reports/:id/messages',
    withCaller(null, async (c, caller) => {
      const a = await body(c, bugReportMessageRequest);
      if (!a) return fail(c, 400, 'invalid-request');
      const me = await who(caller);
      if (!me) return fail(c, 404, 'not-found');
      const r = await accounts.bugReports.addMessage(c.req.param('id')!, { fromAdmin: false, userName: me.name, text: a.text, reporterId: me.userId });
      if (r === 'limit') return fail(c, 409, 'limit');
      return r ? c.json({ ok: true }) : fail(c, 404, 'not-found');
    }),
  );

  // The Superadmin's.
  app.get(
    '/api/reports',
    withCaller('ManageOrganizations', async (c) => c.json(await accounts.bugReports.list())),
  );

  app.get(
    '/api/reports/:id',
    withCaller('ManageOrganizations', async (c) => {
      const r = await accounts.bugReports.get(c.req.param('id')!);
      return r ? c.json(r) : fail(c, 404, 'not-found');
    }),
  );

  /** An answer: in the thread, and by mail when the server sends mail and the one who reported has an address. */
  app.post(
    '/api/reports/:id/messages',
    withCaller('ManageOrganizations', async (c, caller) => {
      const a = await body(c, bugReportMessageRequest);
      if (!a) return fail(c, 400, 'invalid-request');
      const me = await who(caller);
      if (!me) return fail(c, 404, 'not-found');
      const id = c.req.param('id')!;
      const r = await accounts.bugReports.addMessage(id, { fromAdmin: true, userName: me.name, text: a.text });
      if (r === 'limit') return fail(c, 409, 'limit');
      if (!r) return fail(c, 404, 'not-found');
      const mail = deps.mail;
      const to = r.userEmail;
      if (mail && to) inBackground(c, () => mail.mailer.send(bugReplyMail({ to, name: r.userName, answer: a.text, link: myReportLink(mail.appUrl, id) }, r.language)));
      return c.json({ ok: true, mailed: !!(mail && to) });
    }),
  );

  app.patch(
    '/api/reports/:id',
    withCaller('ManageOrganizations', async (c) => {
      const a = await body(c, bugReportDoneRequest);
      if (!a) return fail(c, 400, 'invalid-request');
      return (await accounts.bugReports.setDone(c.req.param('id')!, a.done)) ? c.json({ ok: true }) : fail(c, 404, 'not-found');
    }),
  );

  app.delete(
    '/api/reports/:id',
    withCaller('ManageOrganizations', async (c) => ((await accounts.bugReports.remove(c.req.param('id')!)) ? c.json({ ok: true }) : fail(c, 404, 'not-found'))),
  );
}
