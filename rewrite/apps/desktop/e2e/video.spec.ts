// Video (TODO.md "Video, and which files a device fetches"): a video is
// imported from Lägg till's Video tab, uploaded in parts and kept once, on the
// host's disk; the editor streams a preview; live, the output window plays the
// picture following the operator window's clock, and a paired screen (played
// by Playwright's Chromium) streams it muted and follows.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { launch, type Desktop } from './apps.ts';
import { addSongs, createPresentation, createSong, pickItem, setUpHost } from './flows.ts';

let host: Desktop | undefined;
let browser: Browser | undefined;
test.afterEach(async () => {
  await browser?.close();
  await host?.app.close();
  host = undefined;
  browser = undefined;
});

/** Three seconds of ffmpeg's test pattern (packages/core/test/node/video.test.ts says how they were made). */
const fixture = (name: string) => readFileSync(new URL(`../../../packages/core/test/fixtures/${name}`, import.meta.url));

/** Opens Lägg till on its Video tab. */
async function videoTab(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Lägg till', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Lägg till' });
  await page.keyboard.press('Control+6');
  await expect(picker.getByRole('tab', { name: 'Video' })).toHaveAttribute('aria-selected', 'true');
  return picker;
}

/** Imports a video from the Video tab and adds it to the open presentation, then closes the dialog. */
async function addVideo(page: Page, name = 'Dop.mp4', file = 'h264.mp4') {
  const picker = await videoTab(page);
  await picker.getByTestId('video-tab-file').setInputFiles({ name, mimeType: 'video/mp4', buffer: fixture(file) });
  await picker.getByRole('button', { name, exact: true }).click({ timeout: 15_000 });
  await picker.getByRole('button', { name: `Lägg till ${name}` }).click();
  await picker.getByRole('button', { name: 'Stäng' }).click();
}

/** A temporary screen in Playwright's Chromium, paired with the presenting window by its code. */
async function pairedScreen(page: Page): Promise<Page> {
  const origin = new URL(page.url()).origin;
  browser = await chromium.launch();
  const screen = await browser.newPage();
  await screen.goto(`${origin}/display`);
  const code = (await screen.getByTestId('display-pin').textContent({ timeout: 10_000 }))!;
  await page.getByRole('button', { name: 'Anslut tillfällig skärm' }).click();
  const dialog = page.getByRole('dialog', { name: 'Anslut tillfällig skärm' });
  for (const [i, d] of [...code].entries()) await dialog.getByLabel(`Siffra ${i + 1}`).fill(d);
  await expect(dialog.getByText('Skärmen är ansluten')).toBeVisible();
  await dialog.getByRole('button', { name: 'Stäng' }).click();
  return screen;
}

/** A video element's playback, as the page sees it. */
const playback = (video: Locator) =>
  video.evaluate((v: HTMLVideoElement) => ({ paused: v.paused, time: v.currentTime, muted: v.muted, src: v.getAttribute('src') ?? '', ready: v.readyState }));

test('a video is imported from the Video tab, another codec is refused with a hint, and the editor streams a preview', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  await createPresentation(page, 'Söndag');

  const picker = await videoTab(page);
  await expect(picker.getByText('Inga videor än')).toBeVisible();
  await picker.getByTestId('video-tab-file').setInputFiles([
    { name: 'Dop.mp4', mimeType: 'video/mp4', buffer: fixture('h264.mp4') },
    { name: 'Gammal.mp4', mimeType: 'video/mp4', buffer: fixture('mpeg4.mp4') },
  ]);
  await expect(picker.getByTestId('video-import-failures')).toHaveText('Gammal.mp4: videon är kodad på ett sätt som inte stöds (mp4v). Exportera den som MP4 (H.264) och försök igen.', {
    timeout: 15_000,
  });
  const row = picker.getByRole('list', { name: 'Video' }).getByRole('button', { name: 'Dop.mp4', exact: true });
  await expect(row).toContainText('0:03');
  await expect(row.locator('img')).toHaveAttribute('src', /^blob:/);
  await row.click();
  await picker.getByRole('button', { name: 'Lägg till Dop.mp4' }).click();
  await picker.getByRole('button', { name: 'Stäng' }).click();

  // In the running order with the video's icon; selected, a player that streams it with a token (a <video src> sends no header).
  await pickItem(page, 'Dop.mp4');
  const preview = page.getByTestId('video-preview');
  await expect(preview).toHaveAttribute('src', /^\/api\/play\/gppl_[A-Za-z0-9_-]{43}\/[0-9a-f]{64}$/);
  await expect(preview).toHaveAttribute('poster', /^blob:/);
  await preview.evaluate((v: HTMLVideoElement) => v.play());
  await expect.poll(async () => (await playback(preview)).time, { timeout: 10_000 }).toBeGreaterThan(0.3);
  // The host keeps the video once, on its server's disk, byte for byte as it was picked.
  const hash = (await preview.getAttribute('src'))!.split('/').at(-1)!;
  const media = join(host.dataDir, 'server', 'media', 'org');
  expect(readdirSync(media).map((o) => readFileSync(join(media, o, 'media', hash)).equals(fixture('h264.mp4')))).toEqual([true]);
});

test('live: the output window plays the video in step with the operator window, the next video buffers, and a paired screen follows it muted', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  await createSong(page, 'Sång A', [['Verse 1', 'A ett']]);
  await createPresentation(page, 'Söndag');
  await addSongs(page, ['Sång A']);
  await addVideo(page);

  await page.getByRole('button', { name: 'Starta presentation' }).click();
  const [output] = await Promise.all([host.app.waitForEvent('window'), page.getByRole('checkbox', { name: 'Extern skärm' }).check()]);
  await output.getByTestId('output').waitFor();

  const screen = await pairedScreen(page);

  // The song goes live: the video after it buffers on the output window already.
  await pickItem(page, 'Sång A');
  await page.getByRole('button', { name: 'Sång A 1' }).click();
  await expect(output.getByTestId('slide-text')).toHaveText('A ett');
  await expect(output.getByTestId('buffered-video')).toHaveAttribute('src', /^\/api\/play\//, { timeout: 5_000 });

  // The video goes live: it plays on the output, muted; its sound is the operator window's.
  await pickItem(page, 'Dop.mp4');
  await page.getByRole('button', { name: 'Dop.mp4 1' }).click();
  const player = page.getByTestId('video-player');
  await expect(player).toHaveAttribute('data-playing', 'true', { timeout: 10_000 });
  const onOutput = output.getByTestId('slide-video');
  await expect.poll(async () => (await playback(onOutput)).time, { timeout: 10_000 }).toBeGreaterThan(0.3);
  expect((await playback(onOutput)).muted).toBe(true);

  // The paired screen streams it through its own path, muted, near where the output is.
  const onScreen = screen.getByTestId('slide-video');
  await expect(onScreen).toHaveAttribute('src', /^\/api\/screen\/[A-Za-z0-9_-]{43}\/video\/[0-9a-f]{64}$/, { timeout: 10_000 });
  await expect.poll(async () => (await playback(onScreen)).time, { timeout: 10_000 }).toBeGreaterThan(0.3);
  expect((await playback(onScreen)).muted).toBe(true);

  // Paused on the operator window: the output and the screen pause where it did.
  await player.getByRole('button', { name: 'Pausa video' }).click();
  await expect(player).toHaveAttribute('data-playing', 'false');
  await expect.poll(async () => (await playback(onOutput)).paused, { timeout: 5_000 }).toBe(true);
  await expect.poll(async () => (await playback(onScreen)).paused, { timeout: 5_000 }).toBe(true);
  const at = (await page.getByTestId('video-player').getByRole('slider').getAttribute('aria-valuenow'))!;
  expect(Math.abs((await playback(onOutput)).time - Number(at))).toBeLessThan(1);
  await expect.poll(async () => Math.abs((await playback(onScreen)).time - (await playback(onOutput)).time), { timeout: 5_000 }).toBeLessThan(0.35);
});

test('live: a paired screen that cannot play HEVC shows the still, while the output window plays it', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  await createPresentation(page, 'Söndag');
  // An iPhone's video ("Hög effektivitet"): this Mac's app plays HEVC; Playwright's Chromium, the TV here, does not.
  await addVideo(page, 'IMG_0001.mp4', 'hevc.mp4');
  await page.getByRole('button', { name: 'Starta presentation' }).click();
  const [output] = await Promise.all([host.app.waitForEvent('window'), page.getByRole('checkbox', { name: 'Extern skärm' }).check()]);
  await output.getByTestId('output').waitFor();
  const screen = await pairedScreen(page);

  await page.getByRole('button', { name: 'IMG_0001.mp4 1' }).click();

  await expect.poll(async () => (await playback(output.getByTestId('slide-video'))).time, { timeout: 10_000 }).toBeGreaterThan(0.3);
  const still = screen.getByTestId('slide-image');
  await expect(still).toHaveAttribute('src', /^\/api\/screen\/[A-Za-z0-9_-]{43}\/image\/[0-9a-f]{64}$/, { timeout: 10_000 });
  await expect.poll(() => still.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(160);
  await expect(screen.getByTestId('slide-video')).toHaveCount(0);
});
