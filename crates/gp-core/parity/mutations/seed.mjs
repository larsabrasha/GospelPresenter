// The organisation every check of the mutators starts from: a little of everything, some of it in the trash.
export const H = (c) => c.repeat(64);
/** Blobs known where this runs: a–f; g and h are not. */
export const KNOWN = ['a', 'b', 'c', 'd', 'e', 'f'].map(H);
export const UNKNOWN = ['g', 'h'].map(H);

const images = `{"images":["img1","img2"]}`;
const bibleContent = JSON.stringify({ translation: 'SFB', slides: [[{ n: 16, t: 'Ty så älskade Gud världen' }]] });

export const SEED = [
  `INSERT INTO labels (id, text, color, sort) VALUES ('label:verse','Verse','#3478c7',0),('label:chorus','Chorus','#c73448',1),('label:kör','Refräng','#7834c7',2)`,
  `INSERT INTO songs (id, name, author, publisher, year, ccli, deleted_at) VALUES ('s1','Härlig är jorden','Ingemann',NULL,1850,'12345',NULL),
     ('s2','Amazing grace','Newton','Public',1779,NULL,NULL),('s3','Blott en dag',NULL,NULL,NULL,NULL,NULL),('s4','Tryggare kan ingen vara',NULL,NULL,NULL,NULL,5)`,
  `INSERT INTO song_parts (id, song_id, sort, label_id, content) VALUES ('sp1','s1',0,'label:verse','Härlig är jorden'),('sp2','s1',1,'label:chorus','Skön är himlen'),
     ('sp3','s1',2,NULL,'Tredje'),('sp4','s2',0,'label:kör','Amazing grace'),('sp5','s4',0,NULL,'Tryggare')`,
  `INSERT INTO song_arrangements (id, song_id, name, part_ids, sort) VALUES ('a1','s1','Kort','["sp1","sp2","sp1"]',0),('a2','s2','Lång','[]',0),('a3','s1',NULL,'["sp3"]',1)`,
  `INSERT INTO song_versions (id, song_id, user_id, created_at, name, data) VALUES ('s1@1','s1','u1',1,'Härlig är jorden',
     '{"name":"Härlig är jorden (gammal)","author":null,"publisher":null,"year":1849,"ccli":null,"parts":[{"id":"sp1","labelId":"label:verse","labelText":"Verse","labelColor":"#3478c7","content":"Gammal text"},{"id":"spold","labelId":"label:gone","labelText":"Brygga","labelColor":"#000000","content":"Borta"}],"arrangements":[{"id":"a1","name":"Kort","partIds":["sp1","spold","sp1"]},{"id":"aold","name":null,"partIds":["spold"]}]}')`,
  `INSERT INTO song_materials (id, song_id, kind, title, url, hash, content_type, size, sort, created_at) VALUES ('m1','s1','link','Spotify','https://open.spotify.com/x',NULL,NULL,NULL,0,1)`,
  `INSERT INTO presentations (id, name, is_template, updated_at, deleted_at, theme_id, weekday, time, location) VALUES ('p1','Söndag',0,0,NULL,NULL,NULL,NULL,NULL),('p2','Onsdag',0,0,NULL,'th1',NULL,NULL,NULL),
     ('p3','Fest',0,0,NULL,NULL,NULL,NULL,NULL),('p4','Gammal',0,0,10,NULL,NULL,NULL,NULL),('t1','Mall',1,0,NULL,'light',0,'10:00','Kyrkan'),('t2','Gammal mall',1,0,10,NULL,NULL,NULL,NULL)`,
  `INSERT INTO presentation_items (id, presentation_id, type, title, source_id, sort, arrangement_id, content, overlay_id, note) VALUES
     ('i1','p1','song','Härlig är jorden','s1',0,'a1',NULL,'o1','Lugnt'),('i2','p1','header','Predikan','i2',1,NULL,NULL,NULL,NULL),
     ('i3','p1','image','a.jpg','img1',2,NULL,NULL,NULL,NULL),('i4','p1','image','2 bilder','img1',3,NULL,'${images}',NULL,NULL),
     ('i5','p1','bible','Johannes 3:16','bible:sfb',4,NULL,'${bibleContent}',NULL,NULL),('i6','t1','song','Amazing grace','s2',0,NULL,NULL,NULL,NULL),
     ('i7','t1','header','Kollekt','i7',1,NULL,NULL,NULL,'Swish'),('i8','p4','audio','a.mp3','au1',0,NULL,NULL,NULL,NULL),('i9','p2','image','c.jpg','img3',0,NULL,'nej',NULL,NULL)`,
  `INSERT INTO themes (id, name, definition, sort, updated_at) VALUES ('th1','Egen','{}',0,0),('th2','Annan','{}',1,0)`,
  `INSERT INTO overlays (id, title, content, image_id, sort, updated_at) VALUES ('o1','Kollekt','{}',NULL,0,0),('o2','Välkommen',NULL,NULL,1,0)`,
  `INSERT INTO media_blobs (hash, content_type, size, bytes, received_at) VALUES ${KNOWN.map((h) => `('${h}','image/jpeg',10,NULL,0)`).join(',')}`,
  `INSERT INTO images (id, file_name, content_type, full_hash, thumb_hash, width, height, created_at, deleted_at, original_full_hash, original_thumb_hash, original_width, original_height, edit) VALUES
     ('img1','a.jpg','image/jpeg','${H('a')}','${H('b')}',1920,1080,1,NULL,NULL,NULL,NULL,NULL,NULL),
     ('img2','b.jpg','image/webp','${H('c')}','${H('d')}',800,600,2,NULL,'${H('a')}','${H('b')}',1920,1080,'{"straighten":0,"rotate":90,"flip":false,"crop":{"x":0,"y":0,"w":1,"h":1}}'),
     ('img3','c.jpg','image/jpeg','${H('e')}','${H('f')}',10,10,3,20,NULL,NULL,NULL,NULL,NULL)`,
  `INSERT INTO audios (id, file_name, content_type, hash, size, created_at, deleted_at) VALUES ('au1','a.mp3','audio/mpeg','${H('a')}',100,1,NULL),('au2','b.mp3','audio/mpeg','${H('b')}',100,2,30)`,
  `INSERT INTO videos (id, file_name, content_type, codec, hash, size, duration, width, height, still_hash, thumb_hash, created_at, deleted_at) VALUES
     ('v1','a.mp4','video/mp4','h264','${H('a')}',1000,5000,1920,1080,'${H('b')}','${H('c')}',1,NULL),('v2','b.mov','video/quicktime','hevc','${H('d')}',1000,5000,1920,1080,'${H('e')}','${H('f')}',2,40)`,
  `INSERT INTO custom_slides (id, name, pages, created_at, updated_at, deleted_at) VALUES ('c1','Egen','[]',1,1,NULL),('c2','Gammal','[]',2,2,50)`,
  `INSERT INTO bible_blobs (hash, verse_count) VALUES ('${H('1')}',100),('${H('2')}',200),('${H('3')}',300)`,
  `INSERT INTO bible_texts (hash, book, sort, chunk) VALUES ('${H('1')}','JHN',0,'[]'),('${H('2')}','GEN',0,'[]'),('${H('3')}','MAT',0,'[]')`,
  `INSERT INTO bibles (id, name, abbreviation, language, verse_count, content_hash) VALUES ('bible:sfb','Svenska Folkbibeln','SFB','sv',100,'${H('1')}'),('bible:b2000','Bibel 2000','B2000','sv',200,'${H('2')}')`,
  `INSERT INTO displays (id, name, code, kind, created_at) VALUES ('d1','Kyrksal','abcdefg','screen',1),('d2','Webb','hjkmnpq','public',2)`,
  `INSERT INTO org_settings (id, value) VALUES ('defaultThemeId','th1'),('ccliCollection','true')`,
  `INSERT INTO ccli_entries (id, song_id, song_name, ccli, presentation_id, presentation_name, date, reported_at) VALUES
     ('s1|2026-11-01|p1','s1','Härlig är jorden','12345','p1','Söndag','2026-11-01',NULL),('s2|2026-11-01|p1','s2','Amazing grace','999','p1','Söndag','2026-11-01',5)`,
];

/** Names and texts at the edges: blank, padded, at and past a limit, JavaScript's white space, astral characters. */
export const TEXTS = ['Söndag', '  Gudstjänst  ', '', '   ', 'a'.repeat(200), 'a'.repeat(201), ' Ny ', '﻿BOM', '\u0085NEL', 'é🎵'.repeat(67), 'é🎵'.repeat(70), '　Ide ', 42, null];
