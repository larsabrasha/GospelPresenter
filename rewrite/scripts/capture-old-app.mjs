// Screenshots of the old Blazor app (mock mode), every page, desktop and mobile, light and dark.
// Usage: node rewrite/scripts/capture-old-app.mjs <baseUrl> <outDir>
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire(new URL('../apps/desktop/package.json', import.meta.url));
const { chromium } = require('@playwright/test');

const [base = 'http://127.0.0.1:5299', out = './old'] = process.argv.slice(2);
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

const pages = [
  ['home', '/'],
  ['presentation', abs(presentation)],
  ['presentation-item', abs(presentation), async (p) => { await p.locator('[data-id]').first().click({ timeout: 5000 }); }],
  ['stage', abs(presentation) && abs(presentation) + '?stage=true'],
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
].filter(([, path]) => path);

for (const theme of themes) {
  for (const [vp, w, h] of viewports) {
    const ctx = await context(theme, w, h);
    const page = await ctx.newPage();
    for (const [name, path, act] of pages) {
      try {
        await page.goto(base + path, { waitUntil: 'networkidle', timeout: 15000 });
        await page.waitForTimeout(700);
        if (act) {
          await act(page);
          await page.waitForTimeout(500);
        }
        await page.screenshot({ path: `${out}/${name}_${theme}_${vp}.png`, fullPage: false });
        console.log('ok', name, theme, vp);
      } catch (e) {
        console.log('FAIL', name, theme, vp, String(e).split('\n')[0]);
      }
    }
    await ctx.close();
  }
}
await browser.close();
