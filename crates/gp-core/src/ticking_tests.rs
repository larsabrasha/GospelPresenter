use super::*;

fn ticks(state: Value, event: Value) -> Value {
    let mut args = state.as_object().unwrap().clone();
    args.insert("event".into(), event);
    view(&args).unwrap()
}

fn base(ticked: &[&str], last: Option<&str>, shown: Option<&str>) -> Value {
    json!({ "order": ["a", "b", "c", "d"], "ticked": ticked, "last": last, "shownId": shown })
}

#[test]
fn starting_ticks_the_row_markera_was_chosen_on() {
    let out = ticks(base(&[], None, None), json!({ "type": "start", "first": "b" }));

    assert_eq!(out["ticked"], json!(["b"]));
}

#[test]
fn starting_on_the_item_shown_ticks_nothing() {
    let out = ticks(base(&[], None, Some("b")), json!({ "type": "start", "first": "b" }));

    assert_eq!(out["ticked"], json!([]));
}

#[test]
fn starting_from_outside_a_row_ticks_nothing() {
    let out = ticks(base(&["a"], Some("a"), None), json!({ "type": "start" }));

    assert_eq!(out["ticked"], json!([]));
}

#[test]
fn a_tick_on_an_unticked_row_ticks_it() {
    let out = ticks(base(&["a"], Some("a"), None), json!({ "type": "tick", "itemId": "c", "range": false }));

    assert_eq!(out["ticked"], json!(["a", "c"]));
}

#[test]
fn a_tick_on_a_ticked_row_unticks_it() {
    let out = ticks(base(&["a", "c"], Some("a"), None), json!({ "type": "tick", "itemId": "a", "range": false }));

    assert_eq!(out["ticked"], json!(["c"]));
}

#[test]
fn a_range_ticks_every_row_from_the_last_one_ticked() {
    let out = ticks(base(&["a"], Some("a"), None), json!({ "type": "tick", "itemId": "c", "range": true }));

    assert_eq!(out["ticked"], json!(["a", "b", "c"]));
}

#[test]
fn a_range_upwards_ticks_the_rows_between_too() {
    let out = ticks(base(&["d"], Some("d"), None), json!({ "type": "tick", "itemId": "b", "range": true }));

    assert_eq!(out["ticked"], json!(["b", "c", "d"]));
}

#[test]
fn a_range_with_nothing_ticked_before_is_one_tick() {
    let out = ticks(base(&[], None, None), json!({ "type": "tick", "itemId": "c", "range": true }));

    assert_eq!(out["ticked"], json!(["c"]));
}

#[test]
fn a_range_over_the_item_shown_leaves_it_out() {
    let out = ticks(base(&["a"], Some("a"), Some("b")), json!({ "type": "tick", "itemId": "c", "range": true }));

    assert_eq!(out["ticked"], json!(["a", "c"]));
}

#[test]
fn a_tick_moves_where_the_next_range_starts() {
    let out = ticks(base(&[], Some("a"), None), json!({ "type": "tick", "itemId": "c", "range": false }));

    assert_eq!(out["last"], json!("c"));
}

#[test]
fn all_ticks_every_row_but_the_item_shown() {
    let out = ticks(base(&["a"], None, Some("d")), json!({ "type": "all" }));

    assert_eq!(out["ticked"], json!(["a", "b", "c"]));
    assert_eq!(out["allTicked"], json!(true));
}

#[test]
fn all_when_all_are_ticked_unticks_them() {
    let out = ticks(base(&["a", "b", "c", "d"], None, None), json!({ "type": "all" }));

    assert_eq!(out["ticked"], json!([]));
}

#[test]
fn rows_no_longer_in_the_order_are_let_go() {
    let out = view(json!({ "order": ["a", "b"], "ticked": ["x", "b"] }).as_object().unwrap()).unwrap();

    assert_eq!(out["ticked"], json!(["b"]));
}

#[test]
fn an_item_shown_after_it_was_ticked_is_let_go() {
    let out = view(base(&["a", "b"], None, Some("b")).as_object().unwrap()).unwrap();

    assert_eq!(out["ticked"], json!(["a"]));
}

#[test]
fn removing_one_asks_for_one() {
    let out = view(base(&["a"], None, None).as_object().unwrap()).unwrap();

    assert_eq!(out["remove"]["text"], json!("presentation.removeOne"));
    assert_eq!(out["remove"]["done"], json!("presentation.removedOne"));
}

#[test]
fn removing_several_asks_for_their_number() {
    let out = view(base(&["a", "c"], None, None).as_object().unwrap()).unwrap();

    assert_eq!(out["remove"]["text"], json!("presentation.removeMany"));
    assert_eq!(out["remove"]["n"], json!(2));
}

#[test]
fn nothing_ticked_offers_no_removal() {
    let out = view(base(&[], None, None).as_object().unwrap()).unwrap();

    assert_eq!(out["remove"], Value::Null);
}

#[test]
fn ticked_rows_come_back_in_the_running_order() {
    let out = view(base(&["d", "a"], None, None).as_object().unwrap()).unwrap();

    assert_eq!(out["ticked"], json!(["a", "d"]));
}
