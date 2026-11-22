use super::*;

fn rows(chosen: &[&str], online: &[&str], sessions: Value) -> Vec<Value> {
    let displays = json!([
        { "id": "w1", "kind": "public", "name": "Följ med" },
        { "id": "s1", "kind": "screen", "name": "TV i hallen" },
        { "id": "s2", "kind": "screen", "name": "TV i kyrkan" },
    ]);
    let a = json!({ "displays": displays, "sessions": sessions, "online": online, "chosen": chosen, "sessionId": "me" });
    output_rows(a.as_object().unwrap()).unwrap()["rows"].as_array().unwrap().clone()
}

#[test]
fn the_screens_come_before_the_public_outputs() {
    let out = rows(&[], &[], json!([]));

    assert_eq!(out.iter().map(|r| r["id"].clone()).collect::<Vec<_>>(), vec![json!("s1"), json!("s2"), json!("w1")]);
}

#[test]
fn a_screen_with_no_page_open_is_offline_and_not_sent_to() {
    let out = rows(&["s1"], &[], json!([]));

    assert_eq!(out[0]["offline"], json!(true));
    assert_eq!(out[0]["sending"], json!(false));
}

#[test]
fn a_chosen_screen_online_is_sent_to() {
    let out = rows(&["s1"], &["s1"], json!([]));

    assert_eq!(out[0]["sending"], json!(true));
}

#[test]
fn an_output_another_presentation_sends_to_names_it_and_asks_before_taking_it() {
    let others = json!([{ "id": "other", "presentationName": "Kvällsmöte", "outputs": [{ "id": "w1", "viewers": 3 }] }]);

    let out = rows(&["w1"], &[], others);

    assert_eq!(out[2]["elsewhere"], json!("Kvällsmöte"));
    assert_eq!(out[2]["sending"], json!(false));
    assert_eq!(out[2]["takeOver"]["text"], json!("live.takeOverText"));
    assert_eq!(out[2]["takeOver"]["args"], json!({ "output": "Följ med", "presentation": "Kvällsmöte" }));
}

#[test]
fn a_public_output_this_session_sends_to_says_how_many_watch() {
    let mine = json!([{ "id": "me", "presentationName": "Söndag", "outputs": [{ "id": "w1", "viewers": 12 }] }]);

    let out = rows(&["w1"], &[], mine);

    assert_eq!(out[2]["viewers"], json!(12));
    assert_eq!(out[2]["takeOver"], Value::Null);
}

#[test]
fn a_chosen_screen_offline_says_so_as_a_warning() {
    let out = rows(&["s1"], &[], json!([]));

    assert_eq!(out[0]["line"], json!({ "text": "screens.offline", "args": {}, "warn": true }));
}

#[test]
fn an_output_another_presentation_sends_to_names_it_under_the_row() {
    let others = json!([{ "id": "other", "presentationName": "Kvällsmöte", "outputs": [{ "id": "w1" }] }]);

    let out = rows(&[], &[], others);

    assert_eq!(out[2]["line"], json!({ "text": "displays.sending", "args": { "name": "Kvällsmöte" }, "warn": false }));
}

#[test]
fn a_public_output_sent_to_says_how_many_watch() {
    let mine = json!([{ "id": "me", "presentationName": "Söndag", "outputs": [{ "id": "w1", "viewers": 4 }] }]);

    let out = rows(&["w1"], &[], mine);

    assert_eq!(out[2]["line"], json!({ "viewers": 4 }));
}

#[test]
fn a_screen_online_and_not_chosen_has_no_line() {
    let out = rows(&[], &["s1"], json!([]));

    assert_eq!(out[0]["line"], Value::Null);
}
