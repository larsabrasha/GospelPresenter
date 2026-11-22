// Export zips' rows of every format for the `files` group's checks, as views/legacy.mjs made them (its generator taken
// here over a seeded `random`): every table's columns in another order, some missing or extra, ids of every kind,
// pages with pictures of Bilder by id and without, PDF decks, Bible passages, RTF leftovers, themes with pictures,
// outputs' kinds, JSON text written loosely; and values JSON.parse and the Rust core's reader take apart (big and
// written-out numbers, half a UTF-16 pair, keys that are array indexes, a key twice).

/** The tables an import writes, in their order, with their columns (crates/gp-core/src/sync_sql.rs). */
export const COLUMNS = {
  labels: ['id', 'text', 'color', 'sort'],
  org_settings: ['id', 'value'],
  themes: ['id', 'name', 'definition', 'sort', 'updated_at', 'name_at', 'definition_at'],
  bibles: ['id', 'name', 'abbreviation', 'language', 'verse_count', 'content_hash'],
  images: ['id', 'file_name', 'content_type', 'full_hash', 'thumb_hash', 'width', 'height', 'created_at', 'deleted_at', 'original_full_hash', 'original_thumb_hash', 'original_width', 'original_height', 'edit'],
  audios: ['id', 'file_name', 'content_type', 'hash', 'size', 'created_at', 'deleted_at'],
  videos: ['id', 'file_name', 'content_type', 'codec', 'hash', 'size', 'duration', 'width', 'height', 'still_hash', 'thumb_hash', 'created_at', 'deleted_at'],
  overlays: ['id', 'title', 'content', 'image_id', 'sort', 'updated_at', 'title_at', 'content_at'],
  displays: ['id', 'name', 'code', 'kind', 'created_at'],
  songs: ['id', 'name', 'author', 'publisher', 'year', 'ccli', 'deleted_at'],
  song_parts: ['id', 'song_id', 'sort', 'label_id', 'content'],
  song_arrangements: ['id', 'song_id', 'name', 'part_ids', 'sort'],
  song_versions: ['id', 'song_id', 'user_id', 'created_at', 'name', 'data'],
  song_materials: ['id', 'song_id', 'kind', 'title', 'url', 'hash', 'content_type', 'size', 'sort', 'created_at'],
  presentations: ['id', 'name', 'event_date', 'deleted_at', 'theme_id', 'is_template', 'weekday', 'time', 'location', 'last_used_at', 'description', 'updated_at'],
  custom_slides: ['id', 'name', 'pages', 'created_at', 'updated_at', 'deleted_at', 'name_at', 'pages_at'],
  presentation_items: ['id', 'presentation_id', 'type', 'title', 'source_id', 'sort', 'arrangement_id', 'content', 'overlay_id', 'note'],
  ccli_entries: ['id', 'song_id', 'song_name', 'ccli', 'presentation_id', 'presentation_name', 'date', 'reported_at'],
};
const TABLES = Object.keys(COLUMNS);

const STYLE = { fontSize: 72, fontFamily: "Inter, 'Segoe UI', sans-serif", fontWeight: 700, lineHeight: 1.2, color: '#ffffff', align: 'center', shadow: true, uppercase: false, outline: 0, outlineColor: 'rgba(0, 0, 0, 0.5)', area: { x: 80, y: 80, w: 1760, h: 856 }, valign: 'middle' };
const BACKGROUND = { color: '#000000', image: null, fit: 'cover', scrim: 0 };

export function rowMaker(random) {
  const pick = (xs) => xs[Math.floor(random() * xs.length)];
  const int = (n) => Math.floor(random() * n);
  const hex = () => Array.from({ length: 64 }, () => '0123456789abcdef'[int(16)]).join('');
  const HASHES = Array.from({ length: 6 }, hex);
  const hash = () => pick([...HASHES, ...HASHES, '', null, 'not-a-hash', 12, 2 ** 60]);
  const ID = () => pick(['a', 'b', 'c', 'd', 'e', '', 7, null, 'Ä', '10', 2 ** 60, 1e21, 1.5, true, ['x', null, 2]]);
  const loose = (v) => pick([JSON.stringify(v), JSON.stringify(v), JSON.stringify(v, null, 1), `  ${JSON.stringify(v)} `, '{oops', '']);
  const shuffled = (xs) => xs.map((x) => [random(), x]).toSorted((a, b) => a[0] - b[0]).map((p) => p[1]);

  function element(images) {
    const box = { id: pick(['t', 'i', 'r', '𝄞'.repeat(30), 'x'.repeat(41)]), x: int(1920), y: int(1080), w: 100 + int(500), h: 50 + int(300) };
    return pick([
      () => ({ ...box, kind: 'text', text: pick(['Välkommen', '  Kollekt \n Swish  ', '', '𝄞'.repeat(1500)]), size: 40, bold: false, italic: false, align: 'left', color: pick(['#ffffff', null, 'red']) }),
      () => ({ ...box, kind: 'image', picture: { full: pick(HASHES), thumb: pick(HASHES) }, fit: 'contain' }),
      () => ({ ...box, kind: 'image', imageId: pick([...images, 'missing', 7]), fit: 'cover' }),
      () => ({ kind: 'image', imageId: pick(images.length ? images : ['x']), ...box, fit: 'contain', extra: 1 }),
      () => ({ ...box, kind: pick(['rect', 'ellipse']), fill: '#000000', stroke: null, strokeWidth: pick([2, 0, 101]), radius: pick([4, 540, 541]) }),
      () => ({ ...box, kind: 'line', stroke: '#ABCDEF', strokeWidth: pick([1, 0, 100]) }),
      () => pick([null, 'x', 3, []]),
    ])();
  }

  function page(images) {
    const p = { background: pick([null, '#112233', '#12345']), backgroundPicture: pick([null, { full: pick(HASHES), thumb: pick(HASHES) }]), backgroundPage: null, elements: Array.from({ length: int(4) }, () => element(images)) };
    if (random() < 0.3) {
      delete p.backgroundPicture;
      p.backgroundImageId = pick([...images, 'gone', null]);
    }
    if (random() < 0.1) delete p.backgroundPage;
    if (random() < 0.1) p.elements = pick([null, 'x']);
    if (random() < 0.1) delete p.elements;
    if (random() < 0.1) p['2'] = 'index';
    return random() < 0.3 ? Object.fromEntries(shuffled(Object.entries(p))) : p;
  }

  function definition() {
    const d = { song: { background: { ...BACKGROUND }, main: { ...STYLE }, credits: { ...STYLE } }, bible: { background: { ...BACKGROUND }, main: { ...STYLE }, credits: { ...STYLE } }, media: { ...BACKGROUND } };
    for (const bg of [d.song.background, d.bible.background, d.media]) if (random() < 0.4) bg.image = pick([{ kind: 'picture', full: pick(HASHES), thumb: pick(HASHES) }, { kind: 'builtIn', asset: pick(['nature/lake', 'x', 'a/b/c']) }]);
    if (random() < 0.2) d.song.main = { ...STYLE, ...pick([{ fontSize: 9 }, { lineHeight: 3.5 }, { fontFamily: 'Comic"' }, { color: '' }, { area: { x: 0, y: 0, w: 39, h: 40 } }, { valign: 'center' }]) };
    return loose(random() < 0.1 ? { song: 1 } : d);
  }

  let clean = false;
  let serial = 0;

  function row(t, format, images) {
    const r = Object.fromEntries(COLUMNS[t].map((c) => [c, pick(['x', 1, null, 'Söndag', 2 ** 53 + 2, 1e-7, -0])]));
    r.id = clean ? `${t}-${serial++}` : ID();
    if ('updated_at' in r) r.updated_at = pick([100, null, 200]);
    const fill = {
      images: () => Object.assign(r, { full_hash: hash(), thumb_hash: hash(), original_full_hash: hash(), original_thumb_hash: pick([hash(), undefined]) }),
      audios: () => (r.hash = hash()),
      videos: () => Object.assign(r, { hash: pick([hash(), 3]), still_hash: hash(), thumb_hash: hash() }),
      song_materials: () => (r.hash = hash()),
      song_parts: () => (r.content = pick([';;', '\\*;;', ' ; \n', 'Härlig är jorden', ';', '', null, 'a;b'])),
      song_arrangements: () => (r.part_ids = pick([loose(shuffled(['a', 'b', 'c', 7, null, 2 ** 60])), 'x', null])),
      custom_slides: () => (r.pages = pick([loose(Array.from({ length: 1 + int(3) }, () => page(images))), loose([]), null])),
      overlays: () => (r.content = format === 1 ? pick(['Kollekt\nSwish 123', '  ', null, 'x'.repeat(2100), '𝄞'.repeat(1001)]) : pick([loose(page(images)), null])),
      themes: () => (r.definition = definition()),
      displays: () => (r.kind = pick(['public', 'screen', 'scene', null, 5])),
      presentation_items: () => {
        r.type = pick(['song', 'slides', 'bible', 'custom', 'header']);
        r.content =
          r.type === 'slides'
            ? loose({ fileName: 'a.pdf', pages: pick([[{ full: pick(HASHES), thumb: pick(HASHES) }], [], [{ full: 'x' }]]) })
            : r.type === 'bible'
              ? pick([loose({ translation: pick(['SFB', 'x'.repeat(51)]), slides: [[{ n: pick([1, null, 1.5, 1000, 999]), t: 'I begynnelsen' }]] }), '', null, '{"translation":"SFB","slides":[[{"n":1e400,"t":"a"}]]}'])
              : pick(['x', null]);
      },
    }[t];
    fill?.();
    if (format === 1 && t === 'overlays') r.image_id = pick([...images, 'gone', null]);
    if (clean) {
      if (t === 'displays') r.kind = pick(['public', 'screen', 'screen', 'public', 'scene']);
      if (t === 'presentation_items' && r.type === 'bible' && random() < 0.8) r.content = JSON.stringify({ translation: 'SFB', slides: [[{ n: 1, t: 'I begynnelsen' }]] });
      if (t === 'presentation_items' && r.type === 'slides' && format >= 3 && random() < 0.5) r.type = 'song';
      if (t === 'custom_slides' && random() < 0.8) r.pages = JSON.stringify([{ background: null, backgroundPicture: null, backgroundPage: null, elements: [] }]);
      if (random() < 0.97) return r;
    }
    if (random() < 0.04) delete r[pick(Object.keys(r))];
    if (random() < 0.04) r[pick(['extra', '5', '0'])] = 1;
    return random() < 0.3 ? Object.fromEntries(shuffled(Object.entries(r))) : r;
  }

  /** A zip's rows of `format`, with the tables it has. */
  function rowsOf(format) {
    clean = random() < 0.5;
    const images = ['img1', 'img2', 7];
    const rows = {};
    for (const t of TABLES) {
      if (format < 8 && ['themes', 'videos', 'song_materials'].includes(t)) continue;
      if (format < 4 && t === 'custom_slides') continue;
      rows[t] = Array.from({ length: int(4) }, () => row(t, format, images));
    }
    if (rows.images.length) rows.images[0].id = pick(images);
    if (format === 3 || random() < 0.05) rows.slide_decks = Array.from({ length: int(3) }, () => ({ id: ID(), name: pick(['Predikan.pdf', null]), pages: pick([loose([{ full: pick(HASHES), thumb: pick(HASHES) }]), loose([]), '{']) }));
    if (random() < 0.03) rows[pick(TABLES)] = pick([null, 'x', [1], {}]);
    return rows;
  }

  /** The rows as JSON text, now and then written as only other code writes it. */
  function textOf(rows) {
    const text = JSON.stringify(rows);
    return pick([
      () => text,
      () => text,
      () => text,
      () => text.replace(/"sort":(\d+)/, '"sort":$1.0'),
      () => text.replace(/"sort":(\d+)/, '"sort":9007199254740993'),
      () => text.replace(/"sort":(\d+)/, '"sort":1e400'),
      () => text.replace('"id":"', '"id":"\\ud800'),
      () => text.replace('{"labels"', '{"7":1,"labels"'),
      () => text.replace('"id":', '"id":"twice","id":'),
      () => text.replace('"name":', '"__proto__":{"a":1},"name":'),
    ])();
  }

  return { rowsOf, textOf, HASHES, pick, int };
}
