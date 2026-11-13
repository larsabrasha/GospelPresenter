// The organisation every random run starts from: presentations, a template, songs, arrangements and a theme.
export const SEED_SQL = [
  `INSERT INTO presentations (id, name, is_template, updated_at) VALUES ('p1','Söndag',0,0),('p2','Onsdag',0,0),('p3','Fest',0,0),('t1','Mall',1,0)`,
  `INSERT INTO songs (id, name) VALUES ('s1','Härlig är jorden'),('s2','Amazing grace'),('s3','Blott en dag'),('s4','Tryggare kan ingen vara')`,
  `INSERT INTO song_arrangements (id, song_id, name, part_ids, sort) VALUES ('a1','s1','Kort','[]',0),('a2','s2','Lång','[]',0),('a3','s1','Lång','[]',1)`,
  `INSERT INTO themes (id, name, definition, sort, updated_at) VALUES ('th1','Egen','{}',0,0)`,
];
