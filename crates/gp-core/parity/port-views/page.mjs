// The page group of wave 3: pageEventView and pageModelView (a page's state, through sessions of random events on every
// running order of the demo data, the state carried from one answer to the next, and states, contexts and events that
// are not what they should be); presenting's reads (liveSlideView, overlayView, itemOverlaysView, liveTargetsView,
// livePlaybackView, itemAudioView, ccliUseView, displaysView, remoteControlView) and presentationPageView, on every
// presentation, item and slide of the demo data, and on databases made to read every way.
import { emptyDb, rowsOn, rust } from './harness.mjs';

const GARBAGE = [null, 5, 'x', [], true];
const EVENTS = ['sync', 'changed', 'pick', 'clicker', 'step', 'black', 'pickAt', 'show', 'select', 'item', 'move', 'delete', 'add', 'start', 'end', 'digit', 'clearTyped', 'escape', 'enter', 'added'];

/** Each presentation's running order as presenting reads it, [[itemId, slides]…], through the reference. */
async function ordersOf(db) {
  const out = [];
  for (const { id } of db.prepare('SELECT id FROM presentations ORDER BY id').all()) {
    const page = await rust.view('presentationPageView', { id }, rowsOn(db));
    out.push({ id, isTemplate: page.presentation.isTemplate, order: page.items.map((i) => [i.id, page.slides[i.id].slides.length]) });
  }
  return out;
}

function stateCases(orders, { pick, random }) {
  const out = [];
  const maybe = (p, f) => (random() < p ? f() : undefined);
  const strip = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
  const rowsOf = (order) => order.filter(Array.isArray);
  const itemOf = (order) => (rowsOf(order).length && random() < 0.9 ? pick(rowsOf(order))[0] : pick(['gone', '', null, 5]));
  const event = (order, type = pick(EVENTS)) => {
    const item = itemOf(order);
    const n = rowsOf(order).find(([i]) => i === item)?.[1] ?? 2;
    return strip({
      type,
      delta: maybe(0.7, () => pick([1, -1, 1, -1, 2, -3, 0, 1.5, 'x', null])),
      itemId: maybe(0.9, () => item),
      partIndex: maybe(0.9, () => pick([0, 0, Math.max(0, n - 1), Math.floor(random() * (n + 1)), -1, 1.5, '1', null])),
      digit: maybe(0.9, () => pick([0, 1, 1, 2, 3, 5, 9, 10, -1, 1.5, '2', null])),
      onPage: maybe(0.6, () => pick([true, false, 1])),
      itemIds: maybe(0.8, () => (random() < 0.9 ? Array.from({ length: Math.floor(random() * 4) }, () => itemOf(order)) : 'x')),
    });
  };
  // Sessions: the state carried from the reference's answer, the live state changed as the shell changes it.
  for (let session = 0; session < 160; session++) {
    const { id, isTemplate, order } = pick(orders);
    const other = random() < 0.15 ? pick(orders) : null;
    let state = {};
    let live = { presentationId: other?.id ?? null, itemId: null, partIndex: 0, black: false };
    for (let step = 0; step < 40; step++) {
      const presenting = live.presentationId === id;
      const context = { presentationId: id, isTemplate, presenting, live };
      out.push({ name: 'pageModelView', pure: true, args: { state, context, order } });
      const args = { state, context, order, event: event(order) };
      out.push({ name: 'pageEventView', pure: true, args });
      let answer;
      try {
        answer = rust.pure('pageEventView', structuredClone(args));
      } catch {
        continue;
      }
      state = answer.state;
      if (answer.live) live = { ...live, ...answer.live };
      if (answer.command?.type === 'end' || random() < 0.03) live = { presentationId: null, itemId: null, partIndex: 0, black: false };
      // Another window (or a remote control) shows another slide.
      if (presenting && random() < 0.1 && order.length) {
        const [itemId, n] = pick(order);
        live = { ...live, itemId, partIndex: Math.floor(random() * Math.max(1, n)), black: random() < 0.2 };
      }
    }
  }
  // States, contexts and orders of every shape.
  const anyOrder = () => (random() < 0.9 ? pick(orders).order : pick([[], [['a', 2], ['a', 3], ['b', 0]], [['a', 2], 'x', [5, 1], ['b'], ['c', 1.5], ['d', -1]], [{ 0: 'a', 1: 2 }]]));
  const anyLive = (order) => strip({
    presentationId: maybe(0.9, () => pick(['p', 'other', '', null, 5])),
    itemId: maybe(0.9, () => itemOf(order)),
    partIndex: maybe(0.8, () => pick([0, 1, 2, -1, null, 'x'])),
    black: maybe(0.8, () => pick([true, false, false, null, 'yes'])),
  });
  const anyPicked = (order) => pick([null, undefined, 5, 'x', {}, { itemId: itemOf(order), partIndex: pick([0, 1, 2, 7, -1, 1.5, null]) }, { itemId: itemOf(order), partIndex: 0, extra: 1 }, { itemId: itemOf(order) }]);
  for (let n = 0; n < 6000; n++) {
    const order = anyOrder();
    const state = strip({
      presenting: maybe(0.7, () => pick([true, false, 'x', null])),
      selectedId: maybe(0.7, () => itemOf(order)),
      picked: maybe(0.7, () => anyPicked(order)),
      lastAddedId: maybe(0.5, () => itemOf(order)),
      typed: maybe(0.5, () => pick(['', '1', '12', '123', '0', '99', '+5', '-1', 'x', '007', 5, null, '99999999999999999999', ' 1'])),
      followed: maybe(0.5, () => itemOf(order)),
      other: maybe(0.2, () => pick([1, 'x'])),
    });
    const context = strip({
      presentationId: maybe(0.9, () => pick(['p', 'q', null, 5])),
      isTemplate: maybe(0.8, () => pick([true, false, 'true', null])),
      presenting: maybe(0.9, () => pick([true, true, false, 'x', null])),
      live: random() < 0.97 ? anyLive(order) : pick([null, 5, 'x']),
    });
    const args = strip({ state: random() < 0.95 ? state : pick(GARBAGE), context: random() < 0.98 ? context : pick([undefined, ...GARBAGE]), order: random() < 0.98 ? order : pick([undefined, null, 'x', {}]) });
    out.push({ name: 'pageModelView', pure: true, args });
    out.push({ name: 'pageEventView', pure: true, args: { ...args, event: random() < 0.97 ? event(order, random() < 0.98 ? pick(EVENTS) : pick(['nope', '', 5, null])) : pick([undefined, ...GARBAGE]) } });
  }
  for (const args of GARBAGE) out.push({ name: 'pageEventView', pure: true, args }, { name: 'pageModelView', pure: true, args });
  return out;
}

/** Every presentation, item and slide of `db`, each read every way. */
function readCases(db, orders, on, { pick }) {
  const out = [];
  const view = (name, args) => out.push({ name, args, db: on });
  const overlays = [...db.prepare('SELECT id FROM overlays').all().map((r) => r.id), 'gone', '', null, undefined, 5];
  for (const { id, order } of orders) {
    view('presentationPageView', { id });
    view('itemOverlaysView', { presentationId: id });
    view('ccliUseView', { presentationId: id });
    view('livePlaybackView', { presentationId: id });
    for (const [itemId, n] of order) {
      for (let partIndex = 0; partIndex <= n; partIndex++) view('liveSlideView', { presentationId: id, itemId, partIndex, overlayId: pick(overlays) });
      view('liveSlideView', { presentationId: id, itemId, partIndex: pick([-1, 1.5, '0', null, 2 ** 53, undefined]), overlayId: pick(overlays) });
      view('liveTargetsView', { presentationId: id, itemId, overlayId: pick(overlays) });
      view('livePlaybackView', { presentationId: id, itemId });
      view('itemAudioView', { itemId });
      view('ccliUseView', { presentationId: id, itemId });
    }
    view('liveSlideView', { presentationId: id });
    view('liveSlideView', { presentationId: id, itemId: 'gone', overlayId: pick(overlays) });
    view('liveTargetsView', { presentationId: id });
    view('liveTargetsView', { presentationId: id, itemId: 'gone', overlayId: 'gone' });
    view('ccliUseView', { presentationId: id, itemId: 'gone' });
  }
  // An item asked of another presentation, and presentations that are not there.
  const items = orders.flatMap((o) => o.order.map(([i]) => i));
  for (let n = 0; n < 100; n++) {
    const presentationId = pick([...orders.map((o) => o.id), 'gone']);
    const itemId = pick(items);
    for (const name of ['liveSlideView', 'liveTargetsView', 'livePlaybackView', 'ccliUseView']) view(name, { presentationId, itemId, partIndex: 0 });
  }
  for (const id of overlays) view('overlayView', id === undefined ? {} : { id });
  for (const locale of ['sv', 'en', 'en-GB', 'de', 5, undefined]) view('displaysView', locale === undefined ? {} : { locale });
  view('remoteControlView', {});
  view('presentationPageView', { id: 'gone' });
  view('itemAudioView', {});
  view('itemAudioView', { itemId: null });
  // Arguments that are not what they should be.
  const ids = ['', 'x'.repeat(101), '😀'.repeat(100), 5, null, undefined];
  for (const bad of ids) {
    const arg = (k) => (bad === undefined ? {} : { [k]: bad });
    view('presentationPageView', arg('id'));
    for (const name of ['liveSlideView', 'itemOverlaysView', 'liveTargetsView', 'livePlaybackView', 'ccliUseView']) view(name, arg('presentationId'));
    for (const name of ['liveSlideView', 'liveTargetsView', 'livePlaybackView', 'ccliUseView']) view(name, { presentationId: orders[0].id, ...arg('itemId') });
    view('liveTargetsView', { presentationId: orders[0].id, ...arg('overlayId') });
    view('overlayView', arg('id'));
    view('itemAudioView', arg('itemId'));
  }
  for (const name of ['presentationPageView', 'liveSlideView', 'overlayView', 'itemOverlaysView', 'liveTargetsView', 'livePlaybackView', 'itemAudioView', 'ccliUseView', 'displaysView', 'remoteControlView'])
    for (const args of GARBAGE) view(name, args);
  return out;
}

const HASH = (c) => c.repeat(64);

/** Overlays' and slideshows' pages of every shape: as stored, and each way one does not read. */
function pages(pick, random) {
  const text = () => ({ id: pick(['t', '😀'.repeat(40), '😀'.repeat(21), 'x'.repeat(41), '']), kind: 'text', x: pick([0, 1.5, -3840, -3841, 5760]), y: pick([0, 3240, 3241]), w: 100, h: 50,
    text: pick(['Hej', '😀'.repeat(2000), 'x'.repeat(2001), 5]), size: pick([10, 400, 9, 50.5, 72]), bold: pick([true, false, 1]), italic: false, align: pick(['left', 'center', 'middle']), color: pick([null, '#FFFFFF', '#abc', 'red']) });
  const shape = () => ({ id: 's', kind: pick(['rect', 'ellipse', 'line', 'circle']), x: 0, y: 0, w: -10, h: 10, fill: pick([null, '#000000']), stroke: pick([null, '#00ff00', 5]), strokeWidth: pick([0, 1, 100, 101]), radius: pick([0, 540, 541, undefined]) });
  const image = () => ({ id: 'i', kind: 'image', x: 0, y: 0, w: 1, h: 1, picture: pick([{ full: HASH('a'), thumb: HASH('b') }, { full: HASH('A'), thumb: HASH('b') }, { full: HASH('a') }, null, undefined]), fit: pick(['contain', 'cover', 'fill']) });
  const page = () => ({
    background: pick([null, '#123456', '#12345g', undefined]),
    backgroundPicture: pick([null, { full: HASH('c'), thumb: HASH('d') }, undefined, 5]),
    backgroundPage: pick([null, null, { full: HASH('e'), thumb: HASH('f') }]),
    elements: random() < 0.95 ? Array.from({ length: Math.floor(random() * 4) }, () => pick([text, shape, image])()) : pick([Array.from({ length: 101 }, () => ({})), 'x', null]),
    extra: pick([undefined, 1]),
  });
  return [...Array.from({ length: 60 }, () => JSON.stringify(page())), 'not json', '[]', '5', 'null', '{"background":null,"backgroundPicture":null,"backgroundPage":null,"elements":[],"x":1e400}', '{"background":"\\ud800","backgroundPicture":null,"backgroundPage":null,"elements":[]}', '{"background":null,"backgroundPicture":null,"backgroundPage":null,"elements":[{"id":"a","kind":"line","x":1e-7,"y":2.50,"w":0,"h":0,"stroke":null,"strokeWidth":1.0}]}'];
}

/** A database made to read every way: items of odd kinds and values, videos, sounds and songs as SQLite may hold them, outputs and settings. */
function madeDb({ pick, random }, settings) {
  const db = emptyDb(['PRAGMA foreign_keys = OFF', ...settings]);
  const run = (sql, ...p) => db.prepare(sql).run(...p);
  const contents = pages(pick, random);
  contents.forEach((content, k) => run('INSERT INTO overlays (id, title, content, image_id, sort, updated_at) VALUES (?, ?, ?, ?, ?, ?)', `ov-${k}`, pick(['Logga', 5]), content, pick([null, 'img']), pick([0, 1, k]), pick([null, 3])));
  run("INSERT INTO overlays (id, title, content, sort) VALUES ('ov-null', 'Ingen', NULL, 9)");
  run("INSERT INTO videos (id, file_name, content_type, codec, hash, size, duration, width, height, still_hash, thumb_hash, created_at, deleted_at) VALUES ('v1', 'a.mov', 'video/quicktime', 'hevc', 'vh', 5, 6.5, 7, 8, 'vs', 'vt', 90, NULL), ('v2', 'b.webm', 'video/webm', 'vp9', 'vh2', '5', 'x', ' 7 ', 8, 'vs', 'vt', 91, 3), ('v3', 5, 'x', 'y', 7, 1.5, 1e300, '1e3', '+4', 'vs', 'vt', '.5', NULL)");
  run("INSERT INTO audios (id, file_name, content_type, hash, size, created_at, deleted_at) VALUES ('a1', 'x.mp3', 'audio/mpeg', 'ah', 9, 70, NULL), ('a2', 6, 'audio/x', 'ah', '9', 'inf', 5)");
  run("INSERT INTO songs (id, name, author, publisher, year, ccli, deleted_at) VALUES ('s1', 'Ära', NULL, NULL, NULL, '123', NULL), ('s2', 'Blank', 'A', 'P', 2020, '  ', NULL), ('s3', 'Ingen', NULL, NULL, NULL, NULL, 4), ('s4', 'Tom', NULL, NULL, NULL, '\u{feff}', NULL), ('s5', 'Nbsp', NULL, NULL, NULL, '\u{85}', NULL), ('s6', 'Tal', NULL, NULL, NULL, 77, NULL)");
  run("INSERT INTO song_parts (id, song_id, sort, label_id, content) VALUES ('s1-p', 's1', 0, NULL, 'Ära vare Gud'), ('s2-p', 's2', 0, NULL, 'Blank')");
  run("INSERT INTO song_arrangements (id, song_id, name, part_ids, sort) VALUES ('s1-a', 's1', 'Kort', '[\"s1-p\"]', 1), ('s1-b', 's1', NULL, 'not json', 0), ('s2-a', 's2', 5, '[]', '2')");
  const kinds = ['song', 'song', 'video', 'video', 'audio', 'header', 'bible', 'image', 'custom', 'other', 'SONG'];
  const sources = { song: ['s1', 's2', 's3', 's4', 's5', 's6', 'gone'], video: ['v1', 'v2', 'v3', 'gone'], audio: ['a1', 'a2', 'gone'] };
  const presentations = [];
  for (let p = 0; p < 12; p++) {
    const id = `p${p}`;
    presentations.push(id);
    run('INSERT INTO presentations (id, name, event_date, theme_id, is_template, time, location, description, updated_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id, pick(['Gudstjänst', 5, '']), pick([null, '2026-11-22']), pick([null, 'light', 'gone', 'classic']), pick([0, 1, 2]), pick([null, '10:00']), null, null, pick([null, 5]), null);
    for (let i = 0, n = Math.floor(random() * 9); i < n; i++) {
      const type = pick(kinds);
      run('INSERT INTO presentation_items (id, presentation_id, type, title, source_id, sort, arrangement_id, content, overlay_id, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        `${id}-i${i}`, id, type, pick(['T', 5]), pick(sources[type] ?? ['x']), pick([i, i, 0, '1', 2.5]), pick([null, 's1-a', 'original']), pick([null, '{"images":["x"]}']),
        pick([null, null, 'ov-1', 'ov-null', 'gone', 5]), pick([null, 'n']));
    }
  }
  const names = ['Kyrksalen', 'kyrksalen', 'Ängen', 'Entré', 'entre', 'Zeta', 'Åsa', 'Öst', 'öst', '10', '9', 'a b', 'ab'];
  for (let d = 0; d < 30; d++) run('INSERT INTO displays (id, name, code, kind, created_at) VALUES (?, ?, ?, ?, ?)', pick([`d${d}`, `D${d}`, `é${d}`]), pick(names), `C${d}`, pick(['screen', 'public', 'other']), pick([null, 5, 5, 1, 2.5, -1, 'x']));
  return { db, presentations };
}

export async function cases(db, { random }) {
  const pick = (xs) => xs[Math.floor(random() * xs.length)];
  const tools = { pick, random };
  const orders = await ordersOf(db);
  const out = [...stateCases(orders, tools), ...readCases(db, orders, db, tools)];
  const settingsOf = [
    ["INSERT INTO org_settings (id, value) VALUES ('remoteControl', 'never'), ('ccliCollection', 'true')"],
    ["INSERT INTO org_settings (id, value) VALUES ('remoteControl', 'presenter'), ('ccliCollection', 'false'), ('defaultThemeId', 'dark')"],
    ["INSERT INTO org_settings (id, value) VALUES ('remoteControl', 'Always'), ('ccliCollection', 'TRUE')"],
    ["INSERT INTO org_settings (id, value) VALUES ('remoteControl', 5), ('ccliCollection', 1)"],
    [],
  ];
  for (const settings of settingsOf) {
    const made = madeDb(tools, settings);
    const madeOrders = await ordersOf(made.db);
    out.push(...readCases(made.db, madeOrders, made.db, tools));
  }
  return out;
}
