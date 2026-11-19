// The core's slideLayoutView (src/slide_layout.rs, with the `layout` feature) against the web's SlideView drawn by
// Chromium and WebKit: the fitted size, each line's text, where it starts across, and its baseline against the
// browser's line top (the same distance for a face and size wherever a line is). Song slides from the demo's songs, as
// they are and as flowing paragraphs, and from GP_REAL_PRO_DIR's .pro files when it is set; in four themes of the faces
// the app ships, which move and change the text: centred, left at the top, right at the foot in capitals, a narrow box.
//   node parity/slide-layout.mjs <demo.sqlite> <gp_core_layout.wasm> <repository root>
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const [demo, wasm, root] = process.argv.slice(2);
const { chromium, webkit } = createRequire(join(root, 'apps/desktop/package.json'))('@playwright/test');

const { instance } = await WebAssembly.instantiate(readFileSync(wasm), { env: { now_ms: () => Date.now() } });
const w = instance.exports;
const enc = new TextEncoder(), dec = new TextDecoder();
const pass = (s) => { const b = enc.encode(s); const p = w.gp_alloc(b.length); new Uint8Array(w.memory.buffer, p, b.length).set(b); return [p, b.length]; };
/** A view that asks no SQL: its answer, or the refusal's code. */
function view(name, args) {
  const st = w.gp_start(...pass(JSON.stringify({ name, args, ctx: { userId: 'u', role: 'user' } })));
  const text = dec.decode(new Uint8Array(w.memory.buffer, w.gp_out_ptr(), w.gp_out_len()));
  return st === 0 ? JSON.parse(text || 'null') : { refused: text };
}

const FONTS = { Inter: 'Inter-variable', Montserrat: 'Montserrat-variable', Lato: 'Lato-400' };
const area = (x, y, width, height) => ({ x, y, w: width, h: height });
const text = (o) => ({ fontSize: 75, fontWeight: 700, lineHeight: 1.4, color: '#ffffff', align: 'center', shadow: false, uppercase: false, outline: 0, outlineColor: '#000000', area: area(80, 80, 1760, 856), valign: 'middle', ...o });
const credits = { ...text({}), fontSize: 40, lineHeight: 1.2, fontFamily: "'Inter', sans-serif", align: 'left', area: area(80, 936, 1760, 112), valign: 'bottom' };
const theme = (main) => ({ definition: { song: { background: { color: '#000000', image: null, fit: 'cover', scrim: 0 }, main: text(main), credits } } });
const THEMES = {
  'Inter 700, centred': theme({ fontFamily: "'Inter', sans-serif" }),
  'Montserrat 400, left, top': theme({ fontFamily: "'Montserrat', sans-serif", fontWeight: 400, align: 'left', valign: 'top', lineHeight: 1.2 }),
  'Lato 400, right, foot, capitals': theme({ fontFamily: "'Lato', sans-serif", fontWeight: 400, align: 'right', valign: 'bottom', uppercase: true, fontSize: 90 }),
  'Inter 400, a narrow box': theme({ fontFamily: "'Inter', sans-serif", fontWeight: 400, area: area(400, 200, 900, 500), fontSize: 64, lineHeight: 1.6 }),
};

function slides() {
  const db = new DatabaseSync(demo);
  const parts = db.prepare('SELECT song_id, content FROM song_parts ORDER BY song_id, sort, id').all();
  const bySong = Object.groupBy(parts, (p) => p.song_id);
  const out = parts.map((p) => p.content);
  for (const texts of Object.values(bySong).map((ps) => ps.map((p) => p.content))) {
    for (let i = 0; i < texts.length; i++) out.push(texts.slice(i, i + 1 + (i % 6)).join(' ').replace(/\s*\n\s*/g, ' '));
  }
  const dir = process.env.GP_REAL_PRO_DIR;
  if (dir) {
    for (const name of readdirSync(dir).filter((n) => n.endsWith('.pro'))) {
      const song = view('proPresenterSongView', { data: readFileSync(join(dir, name)).toString('base64'), fileName: name });
      const texts = (song?.parts ?? []).map((p) => p.content).filter((t) => t.trim());
      out.push(...texts);
      for (let i = 0; i < texts.length; i += 2) out.push(texts.slice(i, i + 1 + (i % 8)).join(' ').replace(/\s*\n\s*/g, ' '));
    }
  }
  return [...new Set(out.filter((t) => t.trim()))];
}

/** In the page: SlideView's main text for each slide, fitted as FittedText fits it, and its lines by its characters. */
function drawInPage({ texts, css }) {
  const content = document.getElementById('content');
  const el = document.getElementById('text');
  Object.assign(content.style, css.content);
  Object.assign(el.style, css.text);
  const base = parseFloat(css.text.fontSize);
  const fits = () => el.offsetHeight <= content.clientHeight + 1;
  const range = document.createRange();
  return texts.map((t) => {
    el.textContent = t;
    el.style.fontSize = `${base}px`;
    let size = base;
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
    const lines = [];
    if (!node) return { size, lines };
    for (let i = 0; i < t.length; i++) {
      const c = t.charCodeAt(i);
      if ((c >= 0xdc00 && c <= 0xdfff) || t[i] === '\n') continue;
      range.setStart(node, i);
      range.setEnd(node, c >= 0xd800 && c <= 0xdbff ? i + 2 : i + 1);
      const r = range.getClientRects()[0];
      if (!r || r.width === 0) continue;
      const last = lines.at(-1);
      if (!last || r.top > last.top + size * 0.5) lines.push({ text: '', x: r.left, top: r.top, width: 0 });
      lines.at(-1).text += t.slice(i, c >= 0xd800 && c <= 0xdbff ? i + 2 : i + 1);
      if (!/\s/.test(t[i])) lines.at(-1).width = r.right - lines.at(-1).x;
    }
    return { size, lines };
  });
}

/** The theme's main text as SlideView styles it (themes.ts's textStyleCss and textAreaCss, styles.css's classes). */
function cssOf(main) {
  const items = { top: 'flex-start', middle: 'center', bottom: 'flex-end' };
  return {
    content: { position: 'absolute', display: 'flex', overflow: 'hidden', left: `${main.area.x}px`, top: `${main.area.y}px`, width: `${main.area.w}px`, height: `${main.area.h}px`, alignItems: items[main.valign] },
    text: { width: '100%', whiteSpace: 'pre-wrap', overflowWrap: 'break-word', fontFamily: main.fontFamily, fontSize: `${main.fontSize}px`, fontWeight: String(main.fontWeight), lineHeight: String(main.lineHeight), textAlign: main.align, textTransform: main.uppercase ? 'uppercase' : 'none' },
  };
}

async function browser(engine, texts) {
  const b = await engine.launch();
  const page = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  const faces = Object.entries(FONTS).map(([family, file]) => {
    const data = readFileSync(join(root, `apps/web/src/assets/fonts/${file}.woff2`)).toString('base64');
    return `@font-face { font-family: '${family}'; font-weight: ${file.endsWith('variable') ? '100 900' : '400'}; src: url(data:font/woff2;base64,${data}) format('woff2'); }`;
  });
  await page.setContent(`<!doctype html><style>${faces.join('\n')} body { margin: 0; }</style><div id="content"><div id="text"></div></div>`);
  await page.evaluate(async () => {
    await Promise.all(["700 75px 'Inter'", "400 75px 'Inter'", "400 75px 'Montserrat'", "400 75px 'Lato'"].map((f) => document.fonts.load(f)));
  });
  const drawn = {};
  for (const [name, t] of Object.entries(THEMES)) drawn[name] = await page.evaluate(drawInPage, { texts, css: cssOf(t.definition.song.main) });
  await b.close();
  return drawn;
}

const texts = slides();
const core = Object.fromEntries(Object.entries(THEMES).map(([name, t]) => [name, texts.map((tx) => view('slideLayoutView', { slide: { kind: 'song', text: tx, credits: null }, theme: t }))]));
// The page's text is the slide's as written; capitals are drawn by text-transform, so lines compare without case.
const squash = (s) => s.replace(/\s+/g, ' ').trim().toUpperCase();
/** Where a browser's main text and the core's part first, or '' where they agree. */
function apart(a, b) {
  const main = a.texts?.[0];
  if (!main) return { why: `refused ${a.refused}` };
  if (main.size !== b.size) return { why: `size ${b.size} against ${main.size}`, sizes: true };
  const ours = main.lines.filter((l) => l.text.trim());
  if (ours.length !== b.lines.length) return { why: `${b.lines.length} lines against ${ours.length}`, line: ours.findIndex((l, k) => squash(l.text) !== squash(b.lines[k]?.text ?? '')) };
  for (const [k, l] of ours.entries()) {
    if (squash(l.text) !== squash(b.lines[k].text)) return { why: `line ${k} "${squash(b.lines[k].text)}" against "${squash(l.text)}"`, line: k };
    if (!/^\s/.test(l.text) && Math.abs(l.x - b.lines[k].x) > 1.5) return { why: `line ${k} at x ${b.lines[k].x.toFixed(1)} against ${l.x}`, across: true };
  }
  return { why: '' };
}

const drawn = { chromium: await browser(chromium, texts), webkit: await browser(webkit, texts) };
let compared = 0;
const counts = { edge: 0, own: 0 };
const differ = [];
const drops = {};
for (const [engine, pages] of Object.entries(drawn)) {
  const other = pages === drawn.chromium ? drawn.webkit : drawn.chromium;
  for (const [name, answers] of Object.entries(core)) {
    const width = THEMES[name].definition.song.main.area.w;
    answers.forEach((a, i) => {
      compared++;
      const b = pages[name][i];
      const d = apart(a, b);
      const main = a.texts?.[0];
      if (!d.why) {
        // The baseline's distance below the line's top, for the check that it is one for a face and size.
        main.lines.filter((l) => l.text.trim()).forEach((l, k) => (drops[`${engine} ${name} ${main.size}`] ??= new Set()).add(Math.round((l.y - b.lines[k].top) * 4) / 4));
        return;
      }
      // A word at the box's edge: the first line apart filled to within 2.5 px of the box by the core or the browser,
      // or the size a pixel apart where the search for it met such a line (the engines round sub-pixel widths apart).
      const near = (l) => (l?.width ?? 0) > width - 2.5;
      const edge = d.sizes ? Math.abs(main.size - b.size) === 1 : d.line >= 0 && (near(main.lines.filter((l) => l.text.trim())[d.line]) || near(b.lines[d.line]));
      // An engine's own: placed across where the other browser agrees with the core (WebKit's centred and right-aligned
      // lines with a hyphen, 1.5 to 6 px off).
      const own = d.across && !apart(a, other[name][i]).why;
      if (edge) counts.edge++;
      else if (own) counts.own++;
      else differ.push(`${engine} ${name}: ${d.why} in ${JSON.stringify(texts[i].slice(0, 60))}`);
    });
  }
}
// The baseline sits the same distance below the line's top for a face and size, wherever the line is: one value each.
const spread = Object.entries(drops).filter(([, s]) => Math.max(...s) - Math.min(...s) > 1).map(([k, s]) => `${k}: ${[...s].join(', ')}`);
const notes = [`${texts.length} slides in ${Object.keys(THEMES).length} themes, Chromium and WebKit`, `${counts.edge} a word at the box's edge`, `${counts.own} placed across by one browser only`];
console.log(`views slide-layout: ${notes.join(', ')}; ${compared} compared, ${differ.length + spread.length} different`);
for (const d of [...differ.slice(0, 12), ...spread.slice(0, 6)]) console.log(`  ${d}`);
