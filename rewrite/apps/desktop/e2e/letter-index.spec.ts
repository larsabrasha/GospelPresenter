// The index along Sånger's edge on a touch screen (Lars, 2026-11-05: drag and swipe on it, as Contacts' on an iPhone):
// a finger kept on it and moved jumps the list to the letter under it, shown big beside the finger until it lets go.
import { expect, test } from '@playwright/test';
import { pro } from '../../../packages/core/test/pro-fixture.ts';
import { launch, type Desktop } from './apps.ts';
import { openAdmin, setUpHost } from './flows.ts';

let host: Desktop | undefined;
test.afterEach(async () => {
  await host?.app.close();
  host = undefined;
});

const LETTERS = 'ABCDEFGHIJKLMNOPRSTUVWYÅÄÖ'.split('');
const song = (letter: string) => ({ name: `${letter}-sång.pro`, mimeType: 'application/octet-stream', buffer: Buffer.from(pro({ name: `${letter}-sång`, groups: [{ id: 'v', name: 'Verse 1', slides: [letter] }] })) });

test('a finger dragged down the index jumps Sånger to the letter under it, shown big while it is held', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  // A phone with a finger: `(pointer: coarse)` matches, so the index shows.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await page.setViewportSize({ width: 390, height: 844 });
  await openAdmin(page, 'Sånger');
  await page.getByTestId('pro-file').setInputFiles(LETTERS.map(song));
  const index = page.getByRole('navigation', { name: 'Register' });
  await expect(index.getByRole('button')).toHaveCount(LETTERS.length);
  // Scrolled to the list's start, once nothing slides any more, the index stands at the top of the screen.
  await page.getByRole('heading', { name: 'A', exact: true }).evaluate((h) => h.scrollIntoView({ block: 'start' }));
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));
  const a = (await index.getByRole('button', { name: 'A', exact: true }).boundingBox())!;
  const m = (await index.getByRole('button', { name: 'M', exact: true }).boundingBox())!;
  expect(m.y + m.height).toBeLessThan(844);

  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(m.x + m.width / 2, m.y + m.height / 2, { steps: 8 });

  await expect(index.locator('[aria-hidden="true"]')).toHaveText('M'); // the big letter beside the finger
  const heading = page.getByRole('heading', { name: 'M', exact: true });
  await expect.poll(async () => (await heading.boundingBox())!.y).toBeLessThan(200); // M's caption at the top
  await page.mouse.up();
  await expect(index.locator('[aria-hidden="true"]')).toHaveCount(0);
});
