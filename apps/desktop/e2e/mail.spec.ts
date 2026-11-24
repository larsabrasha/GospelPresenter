// E-mail (GAPS.md "E-post", decided on 2026-10-31): with a Resend key the host mails a link from the page of someone
// only it has, and the sign-in page offers "Glömt hur du loggar in?". A fake Resend in this process keeps what it is sent.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test } from '@playwright/test';
import { launch, testPort, type Desktop } from './apps.ts';
import { createUser, setUpHost, signOut } from './flows.ts';

interface Sent {
  from: string;
  to: string[];
  subject: string;
  text: string;
}

let host: Desktop | undefined;
let resend: Server | undefined;
test.afterEach(async () => {
  await host?.app.close();
  host = undefined;
  await new Promise((r) => resend?.close(r));
});

/** A fake of Resend's send endpoint: every mail it is posted, and the key it came with. */
async function fakeResend() {
  const sent: (Sent & { key: string })[] = [];
  resend = createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => (body += String(c)));
    req.on('end', () => {
      sent.push({ ...(JSON.parse(body) as Sent), key: String(req.headers.authorization) });
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"id":"1"}');
    });
  });
  await new Promise<void>((r) => resend!.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${(resend.address() as AddressInfo).port}/emails`, sent };
}

test('a link is mailed from the user page, and a new one is asked for on the sign-in page', async () => {
  const fake = await fakeResend();
  const port = testPort();
  const app = `http://127.0.0.1:${port}`;
  host = await launch({ port, env: { GP_RESEND_API_KEY: 're_test', GP_MAIL_FROM: 'Gospel Presenter <noreply@test.se>', GP_APP_URL: app, GP_RESEND_URL: fake.url } });
  const page = host.page;
  await setUpHost(host);

  await createUser(page, 'Bo', 'bo@x.se');
  await page.getByRole('button', { name: 'Skicka inbjudan till bo@x.se' }).click();
  await expect(page.getByText('Inbjudan skickad till bo@x.se')).toBeVisible();
  expect(fake.sent.map((m) => [m.to, m.subject, m.key])).toEqual([[['bo@x.se'], 'Ett nytt sätt att logga in i Gospel Presenter', 'Bearer re_test']]);
  expect(fake.sent[0]!.text).toContain(`${app}/invite#gpin_`);

  await signOut(page);
  await page.getByRole('button', { name: 'Glömt hur du loggar in?' }).click();
  await page.getByLabel('E-post').fill('anna@kyrkan.se');
  await page.getByRole('button', { name: 'Skicka länk' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Om adressen finns hos oss' })).toBeVisible();
  await expect.poll(() => fake.sent.length).toBe(2);
  expect([fake.sent[1]!.to, fake.sent[1]!.subject]).toEqual([['anna@kyrkan.se'], 'Logga in i Gospel Presenter igen']);
});

test('without a Resend key there is no mail button and no "Glömt hur du loggar in?"', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);

  await createUser(page, 'Bo', 'bo@x.se');
  await expect(page.getByRole('button', { name: /^Skicka inbjudan/ })).toHaveCount(0);
  await signOut(page);
  await expect(page.getByRole('button', { name: 'Logga in med Google' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Glömt hur du loggar in?' })).toHaveCount(0);
});
