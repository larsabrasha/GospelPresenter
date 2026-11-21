// How a Bible text is read (bible_texts.rs `read_text`), one rule a test; the views against the web's own functions
// are crates/gp-core/parity/views/bible-texts.mjs.
use super::*;

fn named(json: &str) -> (String, String) { (json.to_string(), sha256_hex(json)) }

#[test]
fn a_canonical_text_reads_as_its_books() {
    let (json, hash) = named(r#"{"v":1,"books":[{"code":"GEN","verses":[[1,1,"I begynnelsen"]]}]}"#);

    assert_eq!(read_text(&json, &hash), Some((vec![("GEN".into(), r#"[[1,1,"I begynnelsen"]]"#.into())], 1)));
}

#[test]
fn a_text_not_named_by_its_hash_is_refused() {
    let (json, _) = named(r#"{"v":1,"books":[{"code":"GEN","verses":[[1,1,"a"]]}]}"#);

    assert_eq!(read_text(&json, &"0".repeat(64)), None);
}

#[test]
fn a_text_is_hashed_as_written_canonically() {
    let spaced = r#"{ "v": 1.0, "books": [ { "code": "GEN", "verses": [ [1.0, 2, "aå"] ], "extra": 1 } ] }"#;
    let (_, hash) = named(r#"{"v":1,"books":[{"code":"GEN","verses":[[1,2,"aå"]]}]}"#);

    assert!(read_text(spaced, &hash).is_some());
}

#[test]
fn a_book_twice_is_refused() {
    let (json, hash) = named(r#"{"v":1,"books":[{"code":"GEN","verses":[[1,1,"a"]]},{"code":"GEN","verses":[[1,2,"b"]]}]}"#);

    assert_eq!(read_text(&json, &hash), None);
}

#[test]
fn a_verse_with_more_than_three_parts_is_refused() {
    let (json, hash) = named(r#"{"v":1,"books":[{"code":"GEN","verses":[[1,1,"a",4]]}]}"#);

    assert_eq!(read_text(&json, &hash), None);
}

#[test]
fn a_code_in_lowercase_is_refused() {
    let (json, hash) = named(r#"{"v":1,"books":[{"code":"gen","verses":[[1,1,"a"]]}]}"#);

    assert_eq!(read_text(&json, &hash), None);
}

#[test]
fn a_verse_is_measured_in_code_points() {
    let verse = |n: usize| named(&format!(r#"{{"v":1,"books":[{{"code":"GEN","verses":[[1,1,"{}"]]}}]}}"#, "😀".repeat(n)));
    let ((at_limit, h1), (over, h2)) = (verse(MAX_VERSE_LENGTH), verse(MAX_VERSE_LENGTH + 1));

    assert_eq!([read_text(&at_limit, &h1).is_some(), read_text(&over, &h2).is_some()], [true, false]);
}

#[test]
fn a_control_character_is_escaped_as_javascript_escapes_it() {
    let (json, hash) = named(r#"{"v":1,"books":[{"code":"GEN","verses":[[1,1,"a\tb\u0001"]]}]}"#);

    assert_eq!(read_text(&json, &hash).map(|(b, _)| b[0].1.clone()), Some(r#"[[1,1,"a\tb\u0001"]]"#.to_string()));
}
