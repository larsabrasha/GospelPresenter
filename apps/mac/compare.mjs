// The painter (Sources/GPMac/SlidePainter.swift) against the web's SlideView, picture by picture
// (docs/native-slide-rendering.md). The Mac app paints the slides (GP_MAC_COMPARE, Sources/GPMac/Compare.swift); this
// draws the same tiles with the app's own renderer page (apps/web's slides.html, as the app bundles it) in Playwright's
// WebKit, without a screen, and gives the share of pixels apart by more than 48 of 255 in a channel, per theme, and the
// slides most apart as SlideView | painter | difference. The iOS simulator's half is made with `-gp.compare <dir>`.
//   S=$(mktemp -d); cp crates/gp-core/parity/.out/fixtures/demo.sqlite $S/
//   (cd apps/web && pnpm exec vite build -c vite.slides.config.ts)
//   GP_MAC_DATA=$S GP_MAC_COMPARE=$S/compare apps/mac/.build/release/GPMac
//   node apps/mac/compare.mjs $S/compare
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { extname, join } from 'node:path';

const [dir] = process.argv.slice(2);
const root = join(import.meta.dirname, '../..');
const { webkit } = createRequire(join(root, 'apps/desktop/package.json'))('@playwright/test');
const slides = join(root, 'apps/web/dist-slides');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.wasm': 'application/wasm' };
const server = createServer((req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const body = readFileSync(join(slides, path));
    res.writeHead(200, { 'Content-Type': types[extname(path)] ?? 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const url = `http://127.0.0.1:${server.address().port}/slides.html`;

const [W, H] = [960, 540];
const tiles = JSON.parse(readFileSync(join(dir, 'tiles.json'), 'utf8'));
const browser = await webkit.launch();
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
await page.goto(url);
await page.waitForFunction(() => typeof window.gpSheet === 'function');
const work = await browser.newPage();

/** In a page of its own: the share of pixels apart, and the two side by side with their difference, as a PNG's data URL. */
function compare({ a, b, w, h }) {
  const load = (src) => new Promise((done) => { const img = new Image(); img.addEventListener('load', () => done(img)); img.src = src; });
  return Promise.all([load(a), load(b)]).then(([ia, ib]) => {
    // On white, as a screenshot of a clear page (an overlay alone) is taken.
    const pixels = (img) => { const c = new OffscreenCanvas(w, h); const x = c.getContext('2d'); x.fillStyle = '#ffffff'; x.fillRect(0, 0, w, h); x.drawImage(img, 0, 0, w, h); return x.getImageData(0, 0, w, h).data; };
    const [pa, pb] = [pixels(ia), pixels(ib)];
    const out = document.createElement('canvas');
    out.width = w * 3;
    out.height = h;
    const x = out.getContext('2d');
    x.drawImage(ia, 0, 0, w, h);
    x.drawImage(ib, w, 0, w, h);
    const diff = x.createImageData(w, h);
    let apart = 0;
    for (let i = 0; i < pa.length; i += 4) {
      const d = Math.max(Math.abs(pa[i] - pb[i]), Math.abs(pa[i + 1] - pb[i + 1]), Math.abs(pa[i + 2] - pb[i + 2]));
      if (d > 48) apart++;
      diff.data[i] = Math.min(255, d * 4);
      diff.data[i + 3] = 255;
    }
    x.putImageData(diff, w * 2, 0);
    return { share: apart / (w * h), picture: out.toDataURL('image/png') };
  });
}

/**
 * The theme with its texts in the face the painter's core laid them out in, where its stack names others first: on
 * iOS Classic's Tahoma is Verdana, as iOS's WebKit falls back, which this Mac's WebKit would draw in Tahoma.
 */
function inFace(theme, face) {
  const first = (stack) => stack.split(',')[0].trim().replaceAll(/['"]/g, '');
  const set = (style) => (face && first(style.fontFamily) !== face && style.fontFamily.includes(face) ? { ...style, fontFamily: `'${face}'` } : style);
  const kind = (k) => ({ ...theme.definition[k], main: set(theme.definition[k].main), credits: set(theme.definition[k].credits) });
  return { ...theme, definition: { ...theme.definition, song: kind('song'), bible: kind('bible') } };
}

const byTheme = {};
let ownWeb = 0;
for (const t of tiles) {
  const theme = (byTheme[t.theme] ??= { apart: [], refused: 0 });
  if (!t.painted) { theme.refused++; continue; }
  // A slide with a picture only where the app's own web view drew it: this Mac's WebKit cannot reach the app's media.
  const own = join(dir, `web-${t.file}`);
  if (t.pictures && !existsSync(own)) { theme.skipped = (theme.skipped ?? 0) + 1; continue; }
  // The app's own web view's picture where it drew one (the same shell), else this Mac's WebKit's.
  let web;
  if (existsSync(own)) {
    web = readFileSync(own);
    ownWeb++;
  } else {
    await page.evaluate((sheet) => window.gpSheet(sheet), { tiles: [{ slide: t.slide, theme: inFace(t.themeValue, t.face), overlay: t.overlay ?? null, label: t.label }], width: W, height: H, columns: 1 });
    web = await page.screenshot({ clip: { x: 0, y: 0, width: W, height: H } });
  }
  const painted = readFileSync(join(dir, t.file));
  const r = await work.evaluate(compare, { a: `data:image/png;base64,${web.toString('base64')}`, b: `data:image/png;base64,${painted.toString('base64')}`, w: W, h: H });
  theme.apart.push({ ...r, file: t.file });
}
await browser.close();
server.close();

console.log(`SlideView drawn by ${ownWeb ? `the app's own web view (${ownWeb})` : "this Mac's WebKit (Playwright)"}`);
const pct = (v) => `${(v * 100).toFixed(3)} %`;
for (const [name, { apart, refused, skipped }] of Object.entries(byTheme)) {
  apart.sort((p, q) => q.share - p.share);
  const shares = apart.map((r) => r.share).toSorted((p, q) => p - q);
  console.log(`${name}: ${apart.length} compared, ${refused} not painted${skipped ? `, ${skipped} with pictures left out` : ''}; pixels apart, median ${pct(shares[shares.length >> 1] ?? 0)}, most ${pct(shares.at(-1) ?? 0)}`);
  for (const [n, r] of apart.slice(0, 3).entries()) {
    writeFileSync(join(dir, `diff-${name}-${n}.png`), Buffer.from(r.picture.split(',')[1], 'base64'));
    console.log(`  ${r.file}: ${pct(r.share)}`);
  }
}
