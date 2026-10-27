// Screenshots of the old Blazor app (mock mode), every page, desktop and mobile, light and dark.
// Usage: node rewrite/scripts/capture-old-app.mjs <baseUrl> <outDir> [name,name,…]
// The optional third argument takes only the named pictures (e.g. presentation,live,stage).
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire(new URL('../apps/desktop/package.json', import.meta.url));
const { chromium } = require('@playwright/test');

const [base = 'http://127.0.0.1:5299', out = './old', only] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const viewports = [['desktop', 1440, 900], ['mobile', 390, 844]];
const themes = ['light', 'dark'];

const browser = await chromium.launch();
async function context(theme, w, h) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: 'sv-SE', colorScheme: theme, deviceScaleFactor: 1 });
  await ctx.addCookies([{ name: '.AspNetCore.Culture', value: 'c=sv|uic=sv', url: base }]);
  await ctx.addInitScript((t) => localStorage.setItem('theme', t), theme);
  // Mock mode: choose the Swedish organisation once; the cookie keeps it.
  const p = await ctx.newPage();
  await p.goto(base, { waitUntil: 'networkidle' });
  const org = p.getByText('Foo Bar Kyrka');
  if (await org.count()) {
    await org.click();
    await p.waitForLoadState('networkidle');
    await p.waitForTimeout(1000);
  }
  await p.close();
  return ctx;
}

// Find ids to fill the routes with.
const probe = await (await context('light', 1440, 900)).newPage();
await probe.goto(base, { waitUntil: 'networkidle' });
const firstHref = async (url, pattern) => {
  await probe.goto(base + url, { waitUntil: 'networkidle' });
  await probe.waitForTimeout(800);
  const hrefs = await probe.$$eval('a[href]', (as) => as.map((a) => a.getAttribute('href')));
  return hrefs.find((h) => pattern.test(h ?? '')) ?? null;
};
const presentation = await firstHref('/', /^\/?presentations\/[^/?]+$/);
const song = await firstHref('/admin/songs', /^\/?admin\/songs\/[^/?]+$/);
const overlay = await firstHref('/admin/overlays', /^\/?admin\/overlays\/[^/?]+$/);
const user = await firstHref('/admin/users', /^\/?admin\/users\/[^/?]+$/);
console.log({ presentation, song, overlay, user });
const abs = (h) => (h ? (h.startsWith('/') ? h : '/' + h) : null);

// The presentation page's steps. On a phone the running order is behind the menu button.
const pickItem = async (p) => {
  const item = p.locator('[data-id] button').first();
  if (!(await item.isVisible())) await p.getByTitle('Meny', { exact: true }).click();
  await p.waitForTimeout(400);
  await item.click({ timeout: 5000 });
  await p.waitForTimeout(400);
  // The menu stays over the page on a phone; tap the dimmed page to close it.
  if (await p.getByTitle('Meny', { exact: true }).isVisible()) await p.mouse.click(380, 400);
};
const goLive = async (p) => {
  await pickItem(p);
  await p.locator('button[title="Starta presentation"]:visible').click({ timeout: 5000 });
  await p.waitForTimeout(800);
  await p.locator('#main button:visible').first().click({ timeout: 5000 });
  await p.waitForTimeout(500);
};
// The session outlives the page on the server: stopped after each picture, so the next starts without it.
const stopLive = async (p) => {
  const stop = p.locator('button[title="Avsluta presentation"]:visible');
  if (!(await stop.count())) await p.locator('button[aria-expanded]:visible', { hasText: 'Nu visas' }).click();
  await p.waitForTimeout(400);
  await stop.click({ timeout: 5000 });
  await p.waitForTimeout(500);
};
const openAdd = async (p, tab) => {
  const add = p.getByRole('button', { name: 'Lägg till', exact: true }).first();
  if (!(await add.isVisible())) await p.getByTitle('Meny', { exact: true }).click();
  await p.waitForTimeout(400);
  await add.click({ timeout: 5000 });
  await p.waitForTimeout(500);
  if (tab) await p.locator('dialog[open]').getByRole('button', { name: tab, exact: true }).click();
  await p.waitForTimeout(500);
};

const pages = [
  ['home', '/'],
  ['presentation', abs(presentation)],
  ['presentation-item', abs(presentation), pickItem],
  ['add-songs', abs(presentation), async (p) => {
    await openAdd(p);
    await p.locator('dialog[open] input[type=text]:visible').fill('a');
    await p.waitForTimeout(500);
    // A song chosen, so the preview shows (on a phone that is the full-screen preview).
    await p.locator('dialog[open] [data-song-list] button:visible').first().click();
  }],
  ['add-bible', abs(presentation), (p) => openAdd(p, 'Bibeltexter')],
  ['add-images', abs(presentation), (p) => openAdd(p, 'Bilder')],
  ['add-audio', abs(presentation), (p) => openAdd(p, 'Ljud')],
  ['live', abs(presentation), goLive, stopLive],
  ['stage', abs(presentation), async (p) => {
    await goLive(p);
    // On a phone the live panel starts folded; its "Nu visas" header opens it.
    const stage = p.locator('button:visible', { hasText: 'Scenläge' });
    if (!(await stage.count())) await p.locator('button[aria-expanded]:visible', { hasText: 'Nu visas' }).click();
    await p.waitForTimeout(500);
    await stage.click({ timeout: 5000 });
  }, async (p) => {
    await p.getByRole('button', { name: 'Lämna scenläge' }).click();
    await p.waitForTimeout(500);
    await stopLive(p);
  }],
  ['trash', '/trash'],
  ['settings', '/settings'],
  ['profile', '/profile'],
  ['admin', '/admin'],
  ['songs', '/admin/songs'],
  ['song', abs(song)],
  ['song-history', abs(song) && abs(song) + '/history'],
  ['images', '/admin/images'],
  ['audios', '/admin/audios'],
  ['bibles', '/admin/bibles'],
  ['overlays', '/admin/overlays'],
  ['overlay', abs(overlay)],
  ['themes', '/admin/themes'],
  ['templates', '/admin/templates'],
  ['labels', '/admin/labels'],
  ['users', '/admin/users'],
  ['user', abs(user)],
  ['devices', '/admin/devices'],
  ['displays', '/admin/displays'],
  ['display', '/display'],
  ['login', '/login'],
].filter(([name, path]) => path && (!only || only.split(',').includes(name)));

for (const theme of themes) {
  for (const [vp, w, h] of viewports) {
    const ctx = await context(theme, w, h);
    const page = await ctx.newPage();
    for (const [name, path, act, after] of pages) {
      try {
        await page.goto(base + path, { waitUntil: 'networkidle', timeout: 15000 });
        await page.waitForTimeout(700);
        if (act) {
          await act(page);
          await page.waitForTimeout(500);
        }
        await page.screenshot({ path: `${out}/${name}_${theme}_${vp}.png`, fullPage: false });
        console.log('ok', name, theme, vp);
        if (after) await after(page);
      } catch (e) {
        console.log('FAIL', name, theme, vp, String(e).split('\n')[0]);
      }
    }
    await ctx.close();
  }
}
await browser.close();
