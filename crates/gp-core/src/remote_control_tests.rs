use super::*;

fn at(item: &str, part: i64) -> Value {
    json!({ "presentationId": "p", "itemId": item, "partIndex": part, "black": false, "overlayId": null, "rev": 4 })
}

fn command_for(pointer: Value, change: Value) -> Value {
    command(json!({ "pointer": pointer, "change": change }).as_object().unwrap()).unwrap()["command"].clone()
}

fn shown(session: Value, pending: Value) -> Value {
    pointer(json!({ "session": session, "pending": pending }).as_object().unwrap()).unwrap()
}

fn takes(pointer: Value, command: Value, item: bool, overlay: bool) -> bool {
    take(json!({ "pointer": pointer, "command": command, "item": item, "overlay": overlay }).as_object().unwrap()).unwrap()["take"] == true
}

#[test]
fn a_command_fills_in_what_the_change_leaves_out_from_the_session() {
    let out = command_for(at("a", 2), json!({ "partIndex": 3 }));

    assert_eq!(out, json!({ "itemId": "a", "partIndex": 3, "black": false }));
}

#[test]
fn a_command_with_the_item_set_to_null_shows_no_item() {
    let out = command_for(at("a", 2), json!({ "itemId": null, "partIndex": 0 }));

    assert_eq!(out["itemId"], Value::Null);
}

#[test]
fn a_command_names_the_overlay_only_when_the_change_toggles_one() {
    let out = command_for(at("a", 2), json!({ "itemId": "b", "partIndex": 0 }));

    assert!(out.get("overlayId").is_none());
}

#[test]
fn a_command_showing_an_overlay_ends_black() {
    let mut black = at("a", 2);
    black["black"] = json!(true);

    let out = command_for(black, json!({ "overlayId": "o1" }));

    assert_eq!((out["overlayId"].as_str(), out["black"].as_bool()), (Some("o1"), Some(false)));
}

#[test]
fn a_pending_command_shows_at_once_before_the_echo() {
    let out = shown(json!({ "presentationId": "p", "pointer": at("a", 0) }), json!({ "itemId": "a", "partIndex": 1, "black": false }));

    assert_eq!((out["pointer"]["partIndex"].as_i64(), out["confirmed"].as_bool()), (Some(1), Some(false)));
}

#[test]
fn the_echo_confirms_the_pending_command() {
    let out = shown(json!({ "presentationId": "p", "pointer": at("a", 1) }), json!({ "itemId": "a", "partIndex": 1, "black": false }));

    assert_eq!(out["confirmed"], true);
}

#[test]
fn the_shown_pointer_keeps_the_reported_number() {
    let out = shown(json!({ "presentationId": "p", "pointer": at("a", 0) }), json!({ "itemId": "b", "partIndex": 0, "black": false }));

    assert_eq!((out["pointer"]["itemId"].as_str(), out["pointer"]["rev"].as_i64()), (Some("b"), Some(4)));
}

#[test]
fn a_session_gone_shows_nothing_presented_and_confirms_nothing() {
    let out = shown(Value::Null, json!({ "itemId": "a", "partIndex": 1, "black": false }));

    assert_eq!((out["pointer"]["presentationId"].clone(), out["confirmed"].as_bool()), (Value::Null, Some(false)));
}

#[test]
fn the_owner_takes_a_command_for_another_slide() {
    assert!(takes(at("a", 0), json!({ "itemId": "a", "partIndex": 1, "black": false }), true, true));
}

#[test]
fn the_owner_ignores_a_command_while_it_presents_nothing() {
    let idle = json!({ "presentationId": null, "itemId": null, "partIndex": 0, "black": false, "overlayId": null, "rev": 0 });

    assert!(!takes(idle, json!({ "itemId": "a", "partIndex": 1, "black": false }), true, true));
}

#[test]
fn the_owner_ignores_a_command_for_an_item_gone_meanwhile() {
    assert!(!takes(at("a", 0), json!({ "itemId": "x", "partIndex": 0, "black": false }), false, true));
}

#[test]
fn the_owner_ignores_a_command_it_shows_already() {
    assert!(!takes(at("a", 1), json!({ "itemId": "a", "partIndex": 1, "black": false }), true, true));
}

#[test]
fn the_owner_takes_an_overlay_toggle_on_the_same_slide() {
    assert!(takes(at("a", 1), json!({ "itemId": "a", "partIndex": 1, "black": false, "overlayId": "o1" }), true, true));
}
