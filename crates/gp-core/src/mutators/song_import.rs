// songs.ts's importSongs: songs read from ProPresenter files, in one mutation so the import is all or nothing.
use super::*;
use super::history::keep_song_version;
use super::labels::ensure_label;
use super::songs::{label_text, part_content, ARRANGEMENTS_LIMIT, PARTS_LIMIT, SONGS_LIMIT};
use crate::json::string_list;

struct Part { id: String, label: Option<String>, content: String }
struct Arrangement { id: String, name: Option<String>, part_ids: Vec<String> }
struct Song { id: String, name: String, author: Option<String>, publisher: Option<String>, ccli: Option<String>, parts: Vec<Part>, arrangements: Vec<Arrangement>, replaces: Option<String> }

fn list<'a>(o: &'a Obj, k: &str, min: usize, max: usize) -> R<&'a Vec<Value>> {
    match o.get(k) { Some(Value::Array(xs)) if (min..=max).contains(&xs.len()) => Ok(xs), _ => Err("invalid-args".into()) }
}

/// `importedSong`.
fn song(v: &Value) -> R<Song> {
    let o = obj(v)?;
    let parts = list(o, "parts", 1, PARTS_LIMIT)?.iter().map(|p| {
        let p = obj(p)?;
        Ok(Part { id: id(p, "id")?, label: label_text(p, "labelText")?, content: part_content(p, "content")? })
    }).collect::<R<Vec<_>>>()?;
    let arrangements = list(o, "arrangements", 0, ARRANGEMENTS_LIMIT)?.iter().map(|x| {
        let x = obj(x)?;
        Ok(Arrangement { id: id(x, "id")?, name: text_given(x, "name", 100)?, part_ids: ids(x, "partIds", 500)? })
    }).collect::<R<Vec<_>>>()?;
    Ok(Song {
        id: id(o, "id")?, name: name(o, "name")?, author: text_given(o, "author", 200)?, publisher: text_given(o, "publisher", 200)?,
        ccli: text_given(o, "ccli", 20)?, parts, arrangements, replaces: id_or_null(o, "replaces")?,
    })
}

/// The importer chose per song: one that `replaces` a song in the library keeps its id and name and takes the file's
/// author, publisher, CCLI number (and no year), parts and arrangements; every other song is added.
pub async fn import_songs(a: &Obj, ctx: &Ctx) -> R<()> {
    let songs = list(a, "songs", 1, 500)?.iter().map(song).collect::<R<Vec<_>>>()?;
    require(ctx, "ManageSongs")?;
    let mut library = ids_of("SELECT id FROM songs WHERE deleted_at IS NULL", vec![]).await;
    let mut live = library.len() as i64;
    for s in songs {
        let replaced = s.replaces.as_ref().filter(|r| library.contains(r)).cloned();
        let song_id = match replaced {
            Some(sid) => {
                keep_song_version(&sid, ctx, true).await;
                sql("UPDATE songs SET author = ?, publisher = ?, year = ?, ccli = ? WHERE id = ?",
                    vec![json!(s.author), json!(s.publisher), Value::Null, json!(s.ccli), json!(sid)]).await;
                sql("DELETE FROM song_arrangements WHERE song_id = ?", vec![json!(sid)]).await;
                sql("DELETE FROM song_parts WHERE song_id = ?", vec![json!(sid)]).await;
                sid
            }
            None => {
                limit(live >= SONGS_LIMIT)?;
                sql("INSERT INTO songs (id, name, author, publisher, ccli) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING",
                    vec![json!(s.id), json!(s.name), json!(s.author), json!(s.publisher), json!(s.ccli)]).await;
                if !library.contains(&s.id) { library.push(s.id.clone()) }
                live += 1;
                s.id.clone()
            }
        };
        for (sort, p) in s.parts.iter().enumerate() {
            let label = ensure_label(p.label.as_deref()).await;
            sql("INSERT INTO song_parts (id, song_id, sort, label_id, content) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING",
                vec![json!(p.id), json!(song_id), json!(sort), json!(label), json!(p.content)]).await;
        }
        let own: Vec<&String> = s.parts.iter().map(|p| &p.id).collect();
        for (sort, x) in s.arrangements.iter().enumerate() {
            let kept: Vec<String> = x.part_ids.iter().filter(|p| own.contains(p)).cloned().collect();
            sql("INSERT INTO song_arrangements (id, song_id, name, part_ids, sort) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING",
                vec![json!(x.id), json!(song_id), json!(x.name), json!(string_list(&kept)), json!(sort)]).await;
        }
    }
    Ok(())
}
