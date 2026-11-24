// Quick Look by the fingers, as Photos (Lars, 2026-11-05): a swipe sideways to the picture after and back, two fingers
// pinching it larger, and a double tap zooming in and back out. The touches are the page's own TouchEvents, as a
// phone sends them.
import { expect, test, type Page } from '@playwright/test';
import { launch, type Desktop } from './apps.ts';
import { openAdmin, setUpHost } from './flows.ts';
import { solidPng } from './png.ts';

let host: Desktop | undefined;
test.afterEach(async () => {
  await host?.app.close();
  host = undefined;
});

type Point = [number, number];

/** Fingers on Quick Look's room: `steps` positions of each finger, the first touching down and the last lifting. */
async function touch(page: Page, steps: Point[][]) {
  await page.getByTestId('quick-look-room').evaluate(async (el, fingers) => {
    const touches = (points: Point[]) => points.map(([x, y], i) => new Touch({ identifier: i, target: el, clientX: x, clientY: y }));
    const send = (type: string, now: Touch[], changed: Touch[]) =>
      el.dispatchEvent(new TouchEvent(type, { touches: now, targetTouches: now, changedTouches: changed, bubbles: true, cancelable: true }));
    send('touchstart', touches(fingers[0]!), touches(fingers[0]!));
    for (const points of fingers.slice(1)) {
      await new Promise((r) => setTimeout(r, 16)); // a frame between moves, as a finger's
      send('touchmove', touches(points), touches(points));
    }
    send('touchend', [], touches(fingers.at(-1)!));
  }, steps);
}

test('a swipe goes to the next picture and back, a pinch zooms one in, and a double tap zooms in and out', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  await openAdmin(page, 'Bilder');
  await page.getByTestId('image-file').setInputFiles([
    { name: 'Blå.png', mimeType: 'image/png', buffer: solidPng(320, 180, [30, 30, 200]) },
    { name: 'Röd.png', mimeType: 'image/png', buffer: solidPng(320, 180, [200, 30, 30]) },
  ]);
  await expect(page.locator('[data-library-item]')).toHaveCount(2);
  // The first in the library's order, so there is one after it.
  const tiles = page.locator('[data-library-item]');
  const first = (await tiles.first().getAttribute('aria-label'))!;
  const second = first === 'Blå.png' ? 'Röd.png' : 'Blå.png';
  await tiles.first().click();
  const look = page.getByTestId('quick-look');
  await expect(look).toHaveAttribute('aria-label', first);
  const room = (await page.getByTestId('quick-look-room').boundingBox())!;
  const [cx, cy] = [room.x + room.width / 2, room.y + room.height / 2];

  // Left goes to the one after, right back.
  await touch(page, [[[cx + 120, cy]], [[cx + 40, cy]], [[cx - 60, cy]], [[cx - 140, cy]]]);
  await expect(look).toHaveAttribute('aria-label', second);
  await touch(page, [[[cx - 140, cy]], [[cx - 40, cy]], [[cx + 60, cy]], [[cx + 140, cy]]]);
  await expect(look).toHaveAttribute('aria-label', first);

  // Two fingers apart: larger, and the same picture still.
  const image = page.getByTestId('quick-look-image');
  await touch(page, [
    [[cx - 20, cy], [cx + 20, cy]],
    [[cx - 50, cy], [cx + 50, cy]],
    [[cx - 80, cy], [cx + 80, cy]],
  ]);
  await expect(image).toHaveCSS('transform', /matrix\((?!1,)/);
  await expect(look).toHaveAttribute('aria-label', first);

  // A double tap zooms back out, and another zooms in again.
  await touch(page, [[[cx, cy]]]);
  await touch(page, [[[cx, cy]]]);
  await expect(image).toHaveCSS('transform', 'none');
  await touch(page, [[[cx, cy]]]);
  await touch(page, [[[cx, cy]]]);
  await expect(image).toHaveCSS('transform', /matrix\(2\.5/);
});
