// The demo data with what it lacks for every view to be read every way: own themes (one broken) and an organisation
// default, overlays (one that does not read) on items, outputs, the remote control policy, CCLI collection on,
// songs with CCLI numbers, a song's history and materials, and a song in the trash. Made once, as a copy beside demo.sqlite.
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
  return (made = db);
}
