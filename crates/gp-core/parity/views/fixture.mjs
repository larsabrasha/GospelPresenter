// The demo data with what it lacks for every view to be read every way: own themes (one broken) and an organisation
// default, overlays (one that does not read) on items, outputs, the remote control policy, CCLI collection on,
// songs with CCLI numbers, a song's history and materials, a song in the trash, and more in the libraries. Made once, as a copy beside demo.sqlite.
import { copyFileSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { BUILT_IN_THEMES } from '../.out/web-queries.mjs';

let made;

export function fixture(file) {
  if (made) return made;
  const copy = file.replace(/\.sqlite$/, '-views.sqlite');
  rmSync(copy, { force: true });
  copyFileSync(file, copy);
  const db = new DatabaseSync(copy);
  const run = (sql, ...p) => db.prepare(sql).run(...p);
  const own = JSON.stringify({ ...BUILT_IN_THEMES[1].definition, extra: 1 });
  run('INSERT INTO themes (id, name, definition, sort, updated_at) VALUES (?, ?, ?, ?, 0)', 'own-1', 'Vår', own, 0);
  run('INSERT INTO themes (id, name, definition, sort, updated_at) VALUES (?, ?, ?, ?, 0)', 'own-bad', 'Trasig', '{"song": 1}', 1);
  run("INSERT INTO org_settings (id, value) VALUES ('defaultThemeId', 'own-1'), ('remoteControl', 'always'), ('ccliCollection', 'true')");
  const page = JSON.parse(db.prepare("SELECT pages FROM custom_slides WHERE id = 'cs-1'").get().pages)[0];
  run('INSERT INTO overlays (id, title, content, sort, updated_at) VALUES (?, ?, ?, 2, 5), (?, ?, ?, 1, NULL)', 'ov-2', 'Logga', JSON.stringify({ ...page, background: null }), 'ov-1', 'Trasig', 'not json');
  run("INSERT INTO displays (id, name, code, kind, created_at) VALUES ('d1', 'Kyrksalen', 'AB12', 'screen', 5), ('d2', 'Webb', 'CD34', 'public', NULL), ('d3', 'Entré', 'EF56', 'screen', 5)");
  const ids = db.prepare('SELECT id FROM presentations ORDER BY id').all().map((r) => r.id);
  ['light', 'own-bad', 'gone', 'own-1', 'classic'].forEach((theme, k) => ids[k] && run('UPDATE presentations SET theme_id = ? WHERE id = ?', theme, ids[k]));
  run("UPDATE presentation_items SET overlay_id = 'ov-2' WHERE rowid % 3 = 0");
  run("UPDATE presentation_items SET overlay_id = 'ov-gone' WHERE rowid % 7 = 0");
  run("UPDATE songs SET ccli = CASE WHEN rowid % 3 = 0 THEN '  ' ELSE '12' || rowid END WHERE rowid % 2 = 0");
  // A song's history (two versions at one time, so the id decides) and its materials: a PDF with its size, a link without.
  run("INSERT INTO song_versions (id, song_id, user_id, created_at, name, data) VALUES ('v1', 'song-0', 'u1', 10, 'Före', '{}'), ('v2', 'song-0', 'u2', 20, 'Efter', '{}'), ('v3', 'song-0', 'u1', 20, 'Samtidigt', '{}')");
  run("INSERT INTO song_materials (id, song_id, kind, title, url, hash, content_type, size, sort, created_at) VALUES ('m1', 'song-0', 'pdf', 'Noter', NULL, 'h1', 'application/pdf', 1234, 1, 5), ('m2', 'song-0', 'link', 'Inspelning', 'https://example.org', NULL, NULL, NULL, 0, 6), ('m3', 'song-1', 'link', 'Annan', 'https://example.org/2', NULL, NULL, NULL, 0, 7)");
  run("UPDATE songs SET deleted_at = 99 WHERE id = 'song-10'");
  // The libraries: an edited JPEG and a trashed picture, a QuickTime HEVC video and a trashed one, two sounds made at
  // one time (the id decides), a slideshow named in lower case and one in the trash.
  run("INSERT INTO images (id, file_name, content_type, full_hash, thumb_hash, width, height, created_at, deleted_at, original_full_hash, original_thumb_hash, original_width, original_height, edit) VALUES ('img-2', 'b.jpg', 'image/jpeg', 'f2', 't2', 1920, 1080, 50, NULL, 'of', 'ot', 4000, 3000, '{\"crop\":1}'), ('img-3', 'c.png', 'image/png', 'f3', 't3', 10, 10, 60, 7, NULL, NULL, NULL, NULL, NULL)");
  run("INSERT INTO videos (id, file_name, content_type, codec, hash, size, duration, width, height, still_hash, thumb_hash, created_at, deleted_at) VALUES ('vid-2', 'a.mov', 'video/quicktime', 'hevc', 'vh', 5, 6, 7, 8, 'vs', 'vt', 90, NULL), ('vid-3', 'b.mp4', 'video/mp4', 'h264', 'vh3', 5, 6, 7, 8, 'vs', 'vt', 91, 3)");
  run("INSERT INTO audios (id, file_name, content_type, hash, size, created_at, deleted_at) VALUES ('aud-2', 'x.mp3', 'audio/mpeg', 'ah', 9, 70, NULL), ('aud-3', 'y.mp3', 'audio/mpeg', 'ah3', 9, 70, NULL)");
  run("INSERT INTO custom_slides (id, name, pages, created_at, updated_at, deleted_at) VALUES ('cs-2', 'apelsin', '[]', 1, 2, NULL), ('cs-3', 'Borta', 'not json', 1, 2, 9)");
  // Templates (two at one time of change, one never stamped, one in the trash), a presentation in the trash, kept offline.
  run("UPDATE presentations SET is_template = 1, updated_at = CASE id WHEN 'pres-2' THEN 40 WHEN 'pres-3' THEN 40 WHEN 'pres-4' THEN NULL ELSE 30 END, last_used_at = 5 WHERE id IN ('pres-2', 'pres-3', 'pres-4', 'pres-5')");
  run("UPDATE presentations SET deleted_at = 8 WHERE id IN ('pres-5', 'pres-6')");
  run("INSERT INTO pinned_presentations (id, pinned_at) VALUES ('pres-main', 1), ('pres-1', 2)");
  // Bibles (one whose text is here, one kept, one neither), and CCLI entries (two on one day, one reported).
  run("INSERT INTO bibles (id, name, abbreviation, language, verse_count, content_hash) VALUES ('b1', 'Bibel 2000', 'B2000', 'sv', 31000, 'hb1'), ('b2', 'King James', 'KJV', NULL, 31102, 'hb2'), ('b3', 'åsna', 'ÅS', 'sv', 5, 'hb3')");
  run("INSERT INTO bible_blobs (hash, verse_count) VALUES ('hb1', 31000)");
  run("INSERT INTO kept_bibles (id, kept_at) VALUES ('b2', 4)");
  run("INSERT INTO ccli_entries (id, song_id, song_name, ccli, presentation_id, presentation_name, date, reported_at) VALUES ('c1', 'song-0', 'Ära', '12', 'pres-1', 'Gudstjänst', '2026-11-01', NULL), ('c2', 'song-1', 'Amen', '34', 'pres-1', 'Gudstjänst', '2026-11-01', 7), ('c3', 'song-0', 'Ära', '12', 'pres-2', 'Afton', '2026-10-25', NULL)");
  return (made = db);
}
