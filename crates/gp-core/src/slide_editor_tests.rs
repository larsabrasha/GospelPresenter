use super::*;

fn args(v: Value) -> Obj { v.as_object().unwrap().clone() }
fn one_page() -> Value { json!([blank()]) }

fn ed(pages: &Value, page: usize, op: Value) -> Value {
    let mut a = op.as_object().unwrap().clone();
    a.insert("pages".into(), pages.clone());
    a.insert("page".into(), json!(page));
    edit(&a).unwrap()
}

#[test]
fn a_new_text_stands_in_the_middle_of_the_stage_and_is_picked() {
    let r = ed(&one_page(), 0, json!({ "op": "add", "kind": "text", "id": "e1" }));

    let e = &r["pages"][0]["elements"][0];

    assert_eq!((e["x"].clone(), e["y"].clone(), e["w"].clone(), e["kind"].clone(), r["picked"].clone()), (json!(360), json!(460), json!(1200), json!("text"), json!("e1")));
}

#[test]
fn a_new_picture_is_fitted_inside_800_by_450() {
    let r = ed(&one_page(), 0, json!({ "op": "add", "kind": "image", "id": "e1", "picture": { "full": "a".repeat(64), "thumb": "b".repeat(64), "width": 1920, "height": 1080 } }));

    assert_eq!((r["pages"][0]["elements"][0]["w"].clone(), r["pages"][0]["elements"][0]["h"].clone()), (json!(800), json!(450)));
}

#[test]
fn a_change_the_schema_refuses_is_refused() {
    let pages = ed(&one_page(), 0, json!({ "op": "add", "kind": "text", "id": "e1" }))["pages"].clone();

    let mut a = args(json!({ "pages": pages, "page": 0, "op": "change", "id": "e1", "patch": { "size": 1000 } }));
    a.insert("x".into(), json!(0));

    assert!(edit(&a).is_err());
}

#[test]
fn reorder_to_the_top_draws_it_last() {
    let p = ed(&one_page(), 0, json!({ "op": "add", "kind": "rect", "id": "a" }))["pages"].clone();
    let p = ed(&p, 0, json!({ "op": "add", "kind": "ellipse", "id": "b" }))["pages"].clone();

    let r = ed(&p, 0, json!({ "op": "reorder", "id": "a", "to": "top" }));

    assert_eq!(r["pages"][0]["elements"][1]["id"], json!("a"));
}

#[test]
fn a_duplicate_stands_40_down_and_right_and_is_picked() {
    let p = ed(&one_page(), 0, json!({ "op": "add", "kind": "rect", "id": "a" }))["pages"].clone();

    let r = ed(&p, 0, json!({ "op": "duplicate", "id": "a", "newId": "b" }));

    assert_eq!((r["pages"][0]["elements"][1]["x"].clone(), r["picked"].clone()), (json!(680), json!("b")));
}

#[test]
fn a_pasted_element_gets_a_new_id_40_down_and_right_and_is_picked() {
    let p = ed(&one_page(), 0, json!({ "op": "add", "kind": "rect", "id": "a" }))["pages"].clone();

    let r = ed(&p, 0, json!({ "op": "insert", "element": p[0]["elements"][0], "id": "b" }));

    assert_eq!((r["pages"][0]["elements"][1]["id"].clone(), r["pages"][0]["elements"][1]["y"].clone(), r["picked"].clone()), (json!("b"), json!(380), json!("b")));
}

#[test]
fn a_copied_page_comes_after_with_new_ids_and_is_opened() {
    let p = ed(&one_page(), 0, json!({ "op": "add", "kind": "rect", "id": "a" }))["pages"].clone();

    let r = ed(&p, 0, json!({ "op": "addPage", "copy": true, "ids": ["a2"] }));

    assert_eq!((r["pages"].as_array().unwrap().len(), r["pages"][1]["elements"][0]["id"].clone(), r["page"].clone()), (2, json!("a2"), json!(1)));
}

#[test]
fn the_last_page_stays() {
    let r = ed(&one_page(), 0, json!({ "op": "removePage" }));

    assert_eq!(r["pages"].as_array().unwrap().len(), 1);
}

#[test]
fn an_overlay_has_no_background_to_change() {
    let mut a = args(json!({ "pages": one_page(), "page": 0, "op": "background", "patch": { "background": "#ff0000" }, "overlay": true }));
    a.insert("y".into(), json!(0));

    assert!(edit(&a).is_err());
}

#[test]
fn a_tap_picks_the_top_element_then_the_one_beneath() {
    let p = ed(&one_page(), 0, json!({ "op": "add", "kind": "rect", "id": "a" }))["pages"].clone();
    let p = ed(&p, 0, json!({ "op": "add", "kind": "ellipse", "id": "b" }))["pages"].clone();
    let at = |picked: Value| hit(&args(json!({ "page": p[0], "x": 960, "y": 540, "picked": picked }))).unwrap();

    assert_eq!((at(Value::Null), at(json!("b")), at(json!("a"))), (json!("b"), json!("a"), json!("b")));
}

#[test]
fn a_tap_beside_every_element_picks_none() {
    let p = ed(&one_page(), 0, json!({ "op": "add", "kind": "ellipse", "id": "b" }))["pages"].clone();

    assert_eq!(hit(&args(json!({ "page": p[0], "x": 5, "y": 5 }))).unwrap(), Value::Null);
}

#[test]
fn a_texts_panel_has_its_text_size_style_alignment_and_colour() {
    let p = ed(&one_page(), 0, json!({ "op": "add", "kind": "text", "id": "e1" }))["pages"].clone();

    let v = view(&args(json!({ "pages": p, "page": 0, "picked": "e1" }))).unwrap();

    let ids: Vec<&str> = v["controls"].as_array().unwrap().iter().map(|c| c["id"].as_str().unwrap()).collect();
    assert_eq!(ids, vec!["text", "size", "style", "align", "color"]);
}

#[test]
fn the_page_panel_offers_to_take_away_a_pdfs_page() {
    let mut page = blank();
    page["backgroundPage"] = json!({ "full": "a".repeat(64), "thumb": "b".repeat(64) });

    let v = view(&args(json!({ "pages": [page], "page": 0 }))).unwrap();

    assert!(v["controls"].as_array().unwrap().iter().any(|c| c["id"] == "removeBackgroundPage"));
}

#[test]
fn a_page_of_the_wrong_shape_is_refused_not_a_panic() {
    let r = edit(&args(json!({ "pages": [5], "page": 0, "op": "background", "patch": {} })));

    assert_eq!(r.unwrap_err(), "invalid-args");
}

#[test]
fn a_copied_page_with_an_element_of_the_wrong_shape_is_refused_not_a_panic() {
    let r = edit(&args(json!({ "pages": [{ "elements": [1] }], "page": 0, "op": "addPage", "copy": true, "ids": ["a"] })));

    assert_eq!(r.unwrap_err(), "invalid-args");
}
