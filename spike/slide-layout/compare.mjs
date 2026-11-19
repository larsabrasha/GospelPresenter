// The probe's check: song slides laid out by the browser as FittedText does it (Chromium and WebKit, headless) and by
// parley (src/main.rs), compared by fitted size, number of lines and where each line starts.
//   GP_REAL_PRO_DIR=<a folder of .pro files> node spike/slide-layout/compare.mjs [out.json]
// The slides: every part of the real songs as it is, and runs of 2 to 4 parts of a song joined, which are too tall
// for the box and are made smaller. Needs crates/gp-core/build.sh (the core reads the .pro files) and a release build
// of this crate (cargo build --release).
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const HERE = new URL('.', import.meta.url).pathname;
const ROOT = join(HERE, '../..');
const { viewRust } = await import(join(ROOT, 'crates/gp-core/parity/diff.mjs'));
const { chromium, webkit } = createRequire(join(ROOT, 'apps/desktop/package.json'))('@playwright/test');

// A face the app ships (GP_FONT: Inter, Montserrat or Lato, GP_WEIGHT) in place of Classic's Tahoma, which it does
// not: Classic's song style otherwise (75 px, bold, 1.4, centred, the canvas minus its padding; themes.ts).
const FAMILY = process.env.GP_FONT ?? 'Inter';
const FILE = { Inter: 'Inter-variable', Montserrat: 'Montserrat-variable', Lato: 'Lato-400' }[FAMILY];
const FONT = join(ROOT, `apps/web/src/assets/fonts/${FILE}.woff2`);
const STYLE = { family: FAMILY, weight: Number(process.env.GP_WEIGHT ?? 700), size: 75, lineHeight: 1.4, width: 1760, height: 856 };
// The control: parley given a box this many pixels narrower than the browser's, which must show differences.
const SKEW = Number(process.env.GP_SKEW ?? 0);

async function slidesOf(dir) {
  const parts = [];
  const joined = [];
  const flowing = [];
  for (const name of readdirSync(dir).filter((n) => n.endsWith('.pro')).sort()) {
    const song = await viewRust(null, 'proPresenterSongView', { data: readFileSync(join(dir, name)).toString('base64'), fileName: name });
    const texts = (song?.parts ?? []).map((p) => p.content).filter((t) => t.trim());
    parts.push(...texts);
    for (let i = 0; i + 1 < texts.length; i += 3) joined.push(texts.slice(i, i + 2 + (i % 3)).join('\n'));
    // Runs of 1 to 8 parts as one flowing paragraph: lines that wrap, and texts made smaller down to the least size.
    for (let i = 0; i < texts.length; i += 2) flowing.push(texts.slice(i, i + 1 + (i % 8)).join(' ').replace(/\s*\n\s*/g, ' '));
  }
  return [...new Set([...parts, ...joined, ...flowing])];
}

/** In the page: FittedText's fit, then where each line starts, by the top of each character that is not white space. */
function measureInPage({ slides, style }) {
  const box = document.getElementById('box');
  const el = document.getElementById('text');
  const fits = () => el.offsetHeight <= box.clientHeight + 1;
  const range = document.createRange();
  return slides.map((text) => {
    el.textContent = text;
    const base = style.size;
    let size = base;
    el.style.fontSize = `${base}px`;
    if (!fits()) {
      let [lo, hi] = [0.35, 1];
      for (let i = 0; i < 8; i++) {
        const mid = (lo + hi) / 2;
        el.style.fontSize = `${base * mid}px`;
        if (fits()) lo = mid;
        else hi = mid;
      }
      size = Math.floor(base * lo);
      el.style.fontSize = `${size}px`;
    }
    const node = el.firstChild;
    const starts = [];
    let last = -Infinity;
    for (let i = 0; node && i < text.length; i++) {
      const c = text.charCodeAt(i);
      if ((c >= 0xdc00 && c <= 0xdfff) || /\s/.test(text[i])) continue;
      range.setStart(node, i);
      range.setEnd(node, c >= 0xd800 && c <= 0xdbff ? i + 2 : i + 1);
      const rect = range.getClientRects()[0];
      if (rect && rect.top > last + size * 0.7) {
        starts.push(i);
        last = rect.top;
      }
    }
    return { size, lines: Math.round(el.getBoundingClientRect().height / (size * style.lineHeight)), starts };
  });
}

async function browser(engine, slides) {
  const b = await engine.launch();
  const page = await b.newPage();
  const font = readFileSync(FONT).toString('base64');
  await page.setContent(`<!doctype html><style>
    @font-face { font-family: '${FAMILY}'; font-weight: ${FILE.endsWith('variable') ? '100 900' : STYLE.weight}; src: url(data:font/woff2;base64,${font}) format('woff2'); }
    body { margin: 0; }
    #box { position: absolute; left: 80px; top: 80px; width: ${STYLE.width}px; height: ${STYLE.height}px; display: flex; align-items: center; overflow: hidden; }
    #text { width: 100%; white-space: pre-wrap; overflow-wrap: break-word; font-family: '${FAMILY}', sans-serif; font-weight: ${STYLE.weight};
            line-height: ${STYLE.lineHeight}; text-align: center; }
  </style><div id="box"><div id="text"></div></div>`);
  await page.evaluate(async (font) => {
    await document.fonts.load(font);
    await document.fonts.ready;
  }, `${STYLE.weight} 75px '${FAMILY}'`);
  const answers = await page.evaluate(measureInPage, { slides, style: STYLE });
  await b.close();
  return answers;
}

function parley(slides) {
  // The face as TrueType: woff2_decompress of the app's file, beside it in .build (README.md).
  const fonts = [join(HERE, `.build/${FILE}.ttf`)];
  const style = { ...STYLE, width: STYLE.width - SKEW };
  const out = execFileSync(join(HERE, 'target/release/slide-layout'), { input: JSON.stringify({ fonts, style, slides }), maxBuffer: 1 << 28 });
  return JSON.parse(out.toString());
}

const same = (a, b) => a.size === b.size && a.lines === b.lines && a.starts.join() === b.starts.join();
const kind = (a, b) => (a.size !== b.size ? 'size' : a.lines !== b.lines ? 'lines' : 'breaks');

const slides = await slidesOf(process.env.GP_REAL_PRO_DIR);
const rust = parley(slides);
// A slide wraps where it has more lines than its text has.
const wraps = slides.filter((t, i) => rust[i].lines > t.split('\n').length).length;
const report = { slides: slides.length, shrunk: rust.filter((r) => r.size < STYLE.size).length, wraps, engines: {} };
const answers = {};
for (const engine of [chromium, webkit]) {
  const got = await browser(engine, slides);
  answers[engine.name()] = got;
  const differ = slides.flatMap((text, i) => (same(got[i], rust[i]) ? [] : [{ i, kind: kind(got[i], rust[i]), text, browser: got[i], parley: rust[i] }]));
  const byKind = Object.groupBy(differ, (d) => d.kind);
  report.engines[engine.name()] = { different: differ.length, ...Object.fromEntries(Object.entries(byKind).map(([k, v]) => [k, v.length])), examples: differ.slice(0, 40) };
}
const browsers = slides.filter((_, i) => !same(answers.chromium[i], answers.webkit[i])).length;
report.chromiumAgainstWebkit = browsers;
writeFileSync(process.argv[2] ?? join(HERE, '.build/report.json'), JSON.stringify(report, null, 1));
console.log(`${report.slides} slides (${report.wraps} with lines that wrap, ${report.shrunk} made smaller, by parley); Chromium and WebKit differ on ${browsers}`);
for (const [name, r] of Object.entries(report.engines)) console.log(`${name} against parley: ${r.different} different (size ${r.size ?? 0}, lines ${r.lines ?? 0}, breaks ${r.breaks ?? 0})`);
