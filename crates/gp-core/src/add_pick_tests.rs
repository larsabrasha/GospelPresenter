use super::*;

fn pick(kind: &str, picked: &[&str], event: Value) -> Value {
    view(json!({ "kind": kind, "picked": picked, "event": event, "presentationId": "p1", "itemId": "new", "afterItemId": "i3" }).as_object().unwrap()).unwrap()
}

fn toggle(id: &str) -> Value { json!({ "type": "toggle", "id": id }) }

#[test]
fn pictures_are_picked_in_the_order_tapped() {
    let out = pick("image", &["b"], toggle("a"));

    assert_eq!(out["picked"], json!(["b", "a"]));
}

#[test]
fn a_picture_tapped_again_is_let_go() {
    let out = pick("image", &["b", "a"], toggle("b"));

    assert_eq!(out["picked"], json!(["a"]));
}

#[test]
fn a_sound_is_picked_one_at_a_time() {
    let out = pick("audio", &["a"], toggle("b"));

    assert_eq!(out["picked"], json!(["b"]));
}

#[test]
fn several_pictures_become_one_item_named_by_their_number() {
    let out = pick("image", &["a"], toggle("b"));

    assert_eq!(out["add"], json!({ "name": "addImageToPresentation", "args": { "itemId": "new", "presentationId": "p1", "afterItemId": "i3", "imageIds": ["a", "b"] } }));
    assert_eq!(out["title"], json!({ "key": "presentation.imagesWord", "n": 2 }));
}

#[test]
fn one_picture_keeps_its_own_name() {
    let out = pick("image", &[], toggle("a"));

    assert_eq!(out["title"], Value::Null);
    assert_eq!(out["added"], json!({ "key": "presentation.added", "n": 1 }));
}

#[test]
fn pictures_for_an_item_are_added_to_it() {
    let out = view(json!({ "kind": "image", "picked": ["a"], "toItemId": "i7" }).as_object().unwrap()).unwrap();

    assert_eq!(out["add"], json!({ "name": "addImagesToItem", "args": { "itemId": "i7", "imageIds": ["a"] } }));
}

#[test]
fn a_video_is_added_by_its_own_command() {
    let out = pick("video", &[], toggle("v"));

    assert_eq!(out["add"]["name"], json!("addVideoToPresentation"));
    assert_eq!(out["add"]["args"]["videoId"], json!("v"));
}

#[test]
fn a_slideshow_is_added_by_its_own_command() {
    let out = pick("slides", &[], toggle("c"));

    assert_eq!(out["add"]["name"], json!("addCustomSlideToPresentation"));
    assert_eq!(out["add"]["args"]["slideId"], json!("c"));
}

#[test]
fn nothing_picked_adds_nothing() {
    let out = view(json!({ "kind": "audio", "picked": [] }).as_object().unwrap()).unwrap();

    assert_eq!(out["add"], Value::Null);
}

#[test]
fn an_unknown_kind_is_refused() {
    let out = view(json!({ "kind": "song", "picked": [] }).as_object().unwrap());

    assert!(out.is_err());
}
