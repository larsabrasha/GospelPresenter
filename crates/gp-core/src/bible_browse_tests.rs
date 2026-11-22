use super::*;

fn step(browse: Value, event: Value) -> Value {
    view(json!({ "browse": browse, "event": event }).as_object().unwrap()).unwrap()
}

/// Browsing JHN with a start at 3:16 and its end chapter 3, picking the end verse.
fn at_end_verse() -> Value {
    json!({ "book": "JHN", "step": "endVerse", "start": [3, 16], "end": null, "endChapter": 3 })
}

#[test]
fn a_book_starts_a_browse_at_its_chapters() {
    let out = view(json!({ "browse": null, "event": { "type": "book", "book": "JHN" } }).as_object().unwrap()).unwrap();

    assert_eq!(out["browse"], json!({ "book": "JHN", "step": "startChapter", "start": null, "end": null, "endChapter": null }));
    assert_eq!(out["ask"], json!({ "book": "JHN" }));
}

#[test]
fn a_start_chapter_shows_its_verses() {
    let out = step(json!({ "book": "JHN", "step": "startChapter", "start": null, "end": null, "endChapter": null }), json!({ "type": "chapter", "n": 3 }));

    assert_eq!(out["browse"]["step"], json!("startVerse"));
    assert_eq!(out["verseChapter"], json!(3));
    assert_eq!(out["prompt"], json!("bible.pickStartVerse"));
}

#[test]
fn a_start_verse_picks_it_alone_and_asks_for_it() {
    let out = step(json!({ "book": "JHN", "step": "startVerse", "start": [3, 0], "end": null, "endChapter": null }), json!({ "type": "verse", "n": 16 }));

    assert_eq!(out["browse"], at_end_verse());
    assert_eq!(out["picked"], json!({ "from": 16, "to": 16 }));
    assert_eq!(out["ask"]["passage"], json!({ "books": ["JHN"], "from": [3, 16], "to": [3, 16] }));
}

#[test]
fn an_end_verse_picks_the_range() {
    let out = step(at_end_verse(), json!({ "type": "verse", "n": 18 }));

    assert_eq!(out["browse"]["end"], json!([3, 18]));
    assert_eq!(out["picked"], json!({ "from": 16, "to": 18 }));
}

#[test]
fn an_end_before_the_start_swaps_them() {
    let out = step(at_end_verse(), json!({ "type": "verse", "n": 14 }));

    assert_eq!(out["browse"]["start"], json!([3, 14]));
    assert_eq!(out["browse"]["end"], json!([3, 16]));
}

#[test]
fn an_end_in_a_later_chapter_picks_to_the_end_of_the_start_chapter() {
    let later = step(at_end_verse(), json!({ "type": "step", "step": "endChapter" }));
    let in_four = step(later["browse"].clone(), json!({ "type": "chapter", "n": 4 }));
    let out = step(in_four["browse"].clone(), json!({ "type": "verse", "n": 2 }));

    assert_eq!(out["picked"], json!({ "from": 1, "to": 2 }));
    assert_eq!(out["ask"]["passage"], json!({ "books": ["JHN"], "from": [3, 16], "to": [4, 2] }));
}

#[test]
fn going_back_to_a_crumb_keeps_what_was_picked() {
    let out = step(at_end_verse(), json!({ "type": "step", "step": "book" }));

    assert_eq!(out["browse"]["start"], json!([3, 16]));
    assert_eq!(out["prompt"], json!("bible.pickBook"));
}

#[test]
fn a_new_start_chapter_lets_go_of_the_range() {
    let back = step(at_end_verse(), json!({ "type": "step", "step": "startChapter" }));
    let out = step(back["browse"].clone(), json!({ "type": "chapter", "n": 5 }));

    assert_eq!(out["browse"]["start"], json!([5, 0]));
    assert_eq!(out["ask"].get("passage"), None);
}

#[test]
fn an_unknown_step_is_refused() {
    let out = view(json!({ "browse": { "book": "JHN", "step": "nowhere" } }).as_object().unwrap());

    assert!(out.is_err());
}
