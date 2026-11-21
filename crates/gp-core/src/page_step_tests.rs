use super::*;

/// The demo's shape: two songs of three slides and two, the second carrying an overlay.
fn order() -> Value { json!([["a", 3], ["b", 2]]) }

fn idle() -> Value { json!({ "presentationId": null, "itemId": null, "partIndex": 0, "black": false, "overlayId": null, "rev": 0 }) }

fn presenting(item: &str, part: i64) -> Value {
    json!({ "presentationId": "p", "itemId": item, "partIndex": part, "black": false, "overlayId": null, "rev": 1 })
}

/// One step of page `p`, open, with the live state `live` and an `event` or a `change`.
fn run(live: Value, state: Value, what: (&str, Value)) -> Value {
    let mut a = json!({
        "state": state, "context": { "presentationId": "p", "isTemplate": false }, "live": live,
        "order": order(), "overlays": { "a": null, "b": "o1" },
    });
    a[what.0] = what.1;
    step(a.as_object().unwrap()).unwrap()
}

#[test]
fn start_presents_the_open_page_and_says_it_changed() {
    let out = run(idle(), json!({}), ("event", json!({ "type": "start" })));

    assert_eq!((out["live"]["presentationId"].as_str(), out["liveChanged"].as_bool()), (Some("p"), Some(true)));
    assert_eq!(out["state"]["presenting"], true);
}

#[test]
fn space_while_presenting_shows_the_next_slide_and_moves_the_marks() {
    let out = run(presenting("a", 0), json!({ "presenting": true }), ("event", json!({ "type": "step", "delta": 1 })));

    assert_eq!(out["live"]["partIndex"], 1);
    assert_eq!(out["marks"], json!({ "shown": { "itemId": "a", "partIndex": 1 }, "next": { "itemId": "a", "partIndex": 2 } }));
}

#[test]
fn stepping_into_an_item_turns_on_its_overlay() {
    let out = run(presenting("a", 2), json!({ "presenting": true }), ("event", json!({ "type": "step", "delta": 1 })));

    assert_eq!((out["live"]["itemId"].as_str(), out["live"]["overlayId"].as_str()), (Some("b"), Some("o1")));
}

#[test]
fn a_key_that_changes_nothing_live_leaves_the_live_state_as_it_was() {
    let live = presenting("a", 0);

    let out = run(live.clone(), json!({ "presenting": true }), ("event", json!({ "type": "pick", "delta": 1 })));

    assert_eq!((out["live"].clone(), out["liveChanged"].as_bool()), (live, Some(false)));
}

#[test]
fn starting_while_another_presentation_is_presented_is_refused() {
    let other = json!({ "presentationId": "q", "itemId": "x", "partIndex": 0, "black": false, "overlayId": null, "rev": 3 });

    let out = run(other.clone(), json!({}), ("change", json!({ "presentationId": "p", "itemId": null, "partIndex": 0, "black": false })));

    assert_eq!((out["refused"].as_str(), out["live"].clone()), (Some("another-presented"), other));
}

#[test]
fn ending_by_a_change_leaves_the_page_not_presenting() {
    let end = json!({ "presentationId": null, "itemId": null, "partIndex": 0, "black": false });

    let out = run(presenting("a", 1), json!({ "presenting": true }), ("change", end));

    assert_eq!((out["state"]["presenting"].as_bool(), out["marks"].is_null(), out["canStart"].as_bool()), (Some(false), true, Some(true)));
}

#[test]
fn a_slide_made_ready_while_presenting_is_cued() {
    let out = run(presenting("a", 0), json!({ "presenting": true }), ("event", json!({ "type": "pick", "delta": 1 })));

    assert_eq!(out["cue"], json!({ "text": "live.cued", "n": 2, "itemId": "a" }));
}

#[test]
fn another_page_open_marks_the_presented_page_from_its_own_order() {
    let mut a = json!({
        "state": {}, "context": { "presentationId": "other", "isTemplate": false }, "live": presenting("a", 0),
        "order": [["z", 1]], "overlays": {}, "liveOrder": order(), "liveOverlays": {}, "event": { "type": "sync" },
    });

    let out = step(a.as_object().unwrap()).unwrap();

    assert_eq!(out["marks"]["next"], json!({ "itemId": "a", "partIndex": 1 }));
}

/// The chain the shells ran before, as the terminal's App ran it: the event, the live change it asks for, the page
/// synced to it, the marks and the model; (state, live, marks, cue).
fn by_hand(state: &Value, live: &Value, event: &Value) -> (Value, Value, Value, Value) {
    let o = |v: Value| v.as_object().cloned().unwrap();
    let cx = |live: &Value| json!({ "presentationId": "p", "isTemplate": false, "presenting": live["presentationId"] == "p", "live": live });
    let answer = crate::page_state::event(&o(json!({ "state": state, "context": cx(live), "order": order(), "event": event }))).unwrap();
    let (mut state, mut live) = (answer["state"].clone(), live.clone());
    if answer["live"].is_object() {
        let change = json!({ "pointer": live, "change": answer["live"], "overlays": { "a": null, "b": "o1" } });
        if let Some(next) = crate::live_state::change(&o(change)).unwrap().get("pointer") {
            live = next.clone();
            let sync = json!({ "state": state, "context": cx(&live), "order": order(), "event": { "type": "sync" } });
            state = crate::page_state::event(&o(sync)).unwrap()["state"].clone();
        }
    }
    let marks = if live["presentationId"] == "p" {
        let shown = json!({ "itemId": live["itemId"], "partIndex": live["partIndex"], "black": live["black"] });
        crate::presenting::marks(&o(json!({ "order": order(), "shown": shown }))).unwrap()
    } else { Value::Null };
    let model = crate::page_state::model(&o(json!({ "state": state, "context": cx(&live), "order": order() }))).unwrap();
    (model["state"].clone(), live, marks, model["cue"].clone())
}

#[test]
fn a_step_answers_as_the_chain_the_shells_ran_on_random_keys() {
    let events = [
        json!({ "type": "start" }), json!({ "type": "step", "delta": 1 }), json!({ "type": "step", "delta": -1 }),
        json!({ "type": "pick", "delta": 1 }), json!({ "type": "pick", "delta": -1 }), json!({ "type": "enter", "onPage": true }),
        json!({ "type": "black" }), json!({ "type": "escape" }), json!({ "type": "digit", "digit": 2 }),
        json!({ "type": "item", "delta": 1 }), json!({ "type": "clicker", "delta": 1 }), json!({ "type": "select", "itemId": "b" }),
        json!({ "type": "show", "itemId": "b", "partIndex": 1 }), json!({ "type": "sync" }),
    ];
    let (mut state, mut live, mut seed) = (json!({}), idle(), 7u64);
    for _ in 0..3000 {
        seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        let event = &events[(seed >> 33) as usize % events.len()];

        let out = run(live.clone(), state.clone(), ("event", event.clone()));
        let expected = by_hand(&state, &live, event);

        assert_eq!((out["state"].clone(), out["live"].clone(), out["marks"].clone(), out["cue"].clone()), expected, "after {event}");
        (state, live) = (out["state"].clone(), out["live"].clone());
    }
}

#[test]
fn neither_an_event_nor_a_change_is_refused() {
    let a = json!({ "state": {}, "context": { "presentationId": "p" }, "live": idle(), "order": order() });

    let out = step(a.as_object().unwrap());

    assert!(out.is_err());
}
