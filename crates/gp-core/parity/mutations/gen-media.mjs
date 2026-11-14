// Random inputs for media.ts's 23 mutators: the library of pictures, sounds and videos, and the items that show them.
import { H, KNOWN, UNKNOWN } from './seed.mjs';

export function generator({ random, pick, maybe, mostly, idsOf, opt, fresh }, step) {
  const lib = (table) => [...idsOf(`SELECT id FROM ${table}`), 'fx'];
  const items = () => [...idsOf('SELECT id FROM presentation_items'), 'ix'];
  const imageItems = () => [...idsOf("SELECT id FROM presentation_items WHERE type = 'image'"), ...items().slice(0, 2)];
  const pres = () => [...idsOf('SELECT id FROM presentations'), 'px'];
  const hash = () => mostly([...KNOWN, ...KNOWN, ...UNKNOWN], [H('g'), 'A'.repeat(64)]);
  const fileName = () => mostly(['bild.jpg', ' Sång.mp3 ', 'x'.repeat(200), 'é🎵'.repeat(100)], ['', '  ', 'x'.repeat(201)]);
  const newId = (p, table) => (random() < 0.9 ? fresh(p) : pick([...lib(table), '', 'x'.repeat(101)]));
  const created = () => mostly([1000 + step, 1], [1.5, null]);
  const pictures = (n) => Array.from({ length: n }, () => pick(lib('images')));
  const edit = () => mostly([{
    straighten: mostly([0, 12.5, -45, 45], [46, -45.1]), rotate: mostly([0, 90, 180, 270], [45, '90', 360]), flip: mostly([true, false], [0]),
    crop: mostly([{ x: 0, y: 0, w: 1, h: 1 }, { x: 0.25, y: 0.1, w: 0.5, h: 0.75 }, { x: 0.5, y: 0.5, w: 0.50005, h: 0.5 }, { y: 0.1, x: 0.2, h: 0.3, w: 0.4, z: 1 }],
      [{ x: 0.5, y: 0, w: 0.6, h: 1 }, { x: 0, y: 0, w: 0, h: 1 }, { x: -0.1, y: 0, w: 1, h: 1 }, null]),
  }], [null, {}]);
  const [kind, table, Kind] = pick([['image', 'images', 'Image'], ['audio', 'audios', 'Audio'], ['video', 'videos', 'Video']]);
  const q = random();
  if (q < 0.1) {
    return { name: 'addImage', args: opt({ id: newId('img', 'images'), fileName: fileName(), contentType: mostly(['image/jpeg', 'image/webp'], ['image/png']), fullHash: hash(), thumbHash: hash(),
      width: mostly([1, 800, 1920], [0, 1921, 1.5]), height: mostly([1, 600, 1080], [1081]), createdAt: created() }) };
  }
  if (q < 0.17) return { name: 'editImage', args: opt({ id: pick(lib('images')), fullHash: hash(), thumbHash: hash(), width: mostly([640, 1920], [0]), height: mostly([480, 1080], [2000]), edit: edit() }) };
  if (q < 0.21) return { name: 'revertImage', args: { id: pick(lib('images')) } };
  if (q < 0.36) {
    const change = pick(['trash', 'trash', 'restore', 'rename', 'purge', 'purge']);
    return { name: `${change}${Kind}`, args: opt({ id: pick(lib(table)), at: change === 'trash' ? created() : undefined, fileName: change === 'rename' ? fileName() : undefined }) };
  }
  if (q < 0.43) {
    return { name: 'addAudio', args: opt({ id: newId('au', 'audios'), fileName: fileName(), contentType: mostly(['audio/mpeg', 'audio/x-m4a', 'audio/wav'], ['audio/flac']), hash: hash(),
      size: mostly([1, 20 * 1024 * 1024], [0, 20 * 1024 * 1024 + 1]), createdAt: created() }) };
  }
  if (q < 0.5) {
    return { name: 'addVideo', args: opt({ id: newId('v', 'videos'), fileName: fileName(), contentType: mostly(['video/mp4', 'video/quicktime'], ['video/webm']), codec: mostly(['h264', 'hevc'], ['av1']),
      hash: hash(), size: mostly([1, 2 * 1024 ** 3], [2 * 1024 ** 3 + 1]), duration: mostly([0, 5000, 86_400_000], [86_400_001, -1]), width: mostly([1, 3840, 16384], [16385]),
      height: mostly([1, 2160], [0]), stillHash: hash(), thumbHash: hash(), createdAt: created() }) };
  }
  if (q < 0.65) {
    const n = mostly([1, 1, 2, 3, 50], [0, 51]);
    return { name: 'addImageToPresentation', args: opt({ itemId: newId('i', 'presentation_items'), presentationId: pick(pres()),
      imageIds: random() < 0.75 ? pictures(n) : undefined, imageId: random() < 0.3 ? pick(lib('images')) : undefined,
      title: maybe(0.5, () => mostly(['3 bilder', ' Bilder '], ['', 'x'.repeat(201)])), afterItemId: maybe(0.4, () => pick([...items(), null])) }) };
  }
  if (q < 0.72) return { name: 'addImagesToItem', args: { itemId: pick(imageItems()), imageIds: pictures(mostly([1, 2, 10, 49], [0, 51])) } };
  if (q < 0.8) return { name: 'removeItemImage', args: { itemId: pick(imageItems()), index: mostly([0, 1, 2, 60], [-1, 1.5]) } };
  if (q < 0.88) return { name: 'moveItemImage', args: { itemId: pick(imageItems()), from: mostly([0, 1, 2, 9], [-1]), to: mostly([0, 1, 3, 60], [0.5]) } };
  if (kind === 'image') return { name: 'addImageToPresentation', args: { itemId: fresh('i'), presentationId: pick(pres()), imageId: pick(lib('images')) } };
  return { name: `add${Kind}ToPresentation`, args: opt({ itemId: newId('i', 'presentation_items'), presentationId: pick(pres()), [`${kind}Id`]: pick(lib(table)), afterItemId: maybe(0.4, () => pick([...items(), null])) }) };
}

/**
 * Every seed has a picture whose id is longer than an image item's content takes (64), so an item of it reads as its
 * first picture alone; the tenth starts at the edge of the limits: 998 pictures, 498 sounds, 498 videos.
 */
export const seedFor = (s) => {
  const long = `INSERT INTO images (id, file_name, content_type, full_hash, thumb_hash, width, height, created_at) VALUES ('${'L'.repeat(70)}', 'lång.jpg', 'image/jpeg', '${H('a')}', '${H('b')}', 1, 1, 0)`;
  if (s !== 10) return [long];
  const many = (n, select) => `${select} FROM (WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < ${n}) SELECT x FROM c)`;
  return [
    long,
    many(995, `INSERT INTO images (id, file_name, content_type, full_hash, thumb_hash, width, height, created_at) SELECT 'bulk' || x, 'b.jpg', 'image/jpeg', '${H('a')}', '${H('b')}', 1, 1, 0`),
    many(497, `INSERT INTO audios (id, file_name, content_type, hash, size, created_at) SELECT 'bulk' || x, 'b.mp3', 'audio/mpeg', '${H('a')}', 1, 0`),
    many(497, `INSERT INTO videos (id, file_name, content_type, codec, hash, size, duration, width, height, still_hash, thumb_hash, created_at) SELECT 'bulk' || x, 'b.mp4', 'video/mp4', 'h264', '${H('a')}', 1, 1, 1, 1, '${H('b')}', '${H('c')}', 0`),
  ];
};
