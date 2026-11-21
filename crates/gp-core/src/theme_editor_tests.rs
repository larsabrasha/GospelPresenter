use super::*;

fn args(v: Value) -> Obj { v.as_object().unwrap().clone() }
fn classic() -> Value { crate::themes::classic_definition() }

#[test]
fn split_color_reads_hex_short_hex_and_rgba() {
    assert_eq!(split_color("#ABC"), ("#aabbcc".to_string(), 100));
    assert_eq!(split_color("rgba(0, 0, 0, 0.4)"), ("#000000".to_string(), 40));
    assert_eq!(split_color("red"), ("#ffffff".to_string(), 100));
}

#[test]
fn join_color_gives_hex_when_opaque_and_rgba_otherwise() {
    assert_eq!(join_color("#ff0000", 100), "#ff0000");
    assert_eq!(join_color("#ff0000", 50), "rgba(255, 0, 0, 0.5)");
}

#[test]
fn the_background_panel_shows_without_a_pick_and_offers_a_picture() {
    let v = view(&args(json!({ "definition": classic(), "kind": "song" }))).unwrap();

    let ids: Vec<&str> = v["groups"][0]["controls"].as_array().unwrap().iter().map(|c| c["id"].as_str().unwrap()).collect();

    assert_eq!((ids, v["hint"].clone()), (vec!["color", "image"], json!("themeEditor.pickHint")));
}

#[test]
fn a_picked_text_shows_its_look_with_the_main_texts_larger_range() {
    let main = view(&args(json!({ "definition": classic(), "kind": "song", "picked": "main" }))).unwrap();
    let credits = view(&args(json!({ "definition": classic(), "kind": "song", "picked": "credits" }))).unwrap();

    assert_eq!((main["groups"][0]["controls"][1]["max"].clone(), credits["groups"][0]["controls"][1]["max"].clone()), (json!(200), json!(100)));
}

#[test]
fn a_pictures_stage_has_no_text_to_pick() {
    let v = view(&args(json!({ "definition": classic(), "kind": "media", "picked": "main" }))).unwrap();

    assert_eq!(v["area"], Value::Null);
}

#[test]
fn a_colour_and_its_opacity_are_kept_as_one_css_colour() {
    let d = edit(&args(json!({ "definition": classic(), "kind": "song", "picked": "main", "id": "color", "value": { "hex": "#ff0000", "alpha": 50 } }))).unwrap();

    assert_eq!(d["song"]["main"]["color"], json!("rgba(255, 0, 0, 0.5)"));
}

#[test]
fn a_box_dragged_off_the_stage_is_kept_on_it() {
    let d = edit(&args(json!({ "definition": classic(), "kind": "bible", "picked": "main", "id": "area", "value": { "x": 1900.4, "y": -20, "w": 600, "h": 10 } }))).unwrap();

    assert_eq!(d["bible"]["main"]["area"], json!({ "x": 1320, "y": 0, "w": 600, "h": 40 }));
}

#[test]
fn reset_placement_puts_the_box_back_where_the_dark_theme_has_it() {
    let moved = edit(&args(json!({ "definition": classic(), "kind": "song", "picked": "credits", "id": "area", "value": { "x": 0, "y": 0, "w": 100, "h": 100 } }))).unwrap();

    let reset = edit(&args(json!({ "definition": moved, "kind": "song", "picked": "credits", "id": "resetPlacement" }))).unwrap();

    assert_eq!((reset["song"]["credits"]["area"].clone(), reset["song"]["credits"]["valign"].clone()), (classic()["song"]["credits"]["area"].clone(), json!("bottom")));
}

#[test]
fn a_value_the_schema_refuses_is_refused() {
    assert!(edit(&args(json!({ "definition": classic(), "kind": "song", "picked": "main", "id": "fontSize", "value": 900 }))).is_err());
}

#[test]
fn a_definition_of_the_wrong_shape_is_refused_not_a_panic() {
    let r = edit(&args(json!({ "definition": { "song": "x" }, "kind": "song", "picked": "main", "id": "align", "value": "left" })));

    assert_eq!(r.unwrap_err(), "invalid-args");
}

#[test]
fn removing_the_picture_leaves_the_background_without_one() {
    let d = edit(&args(json!({ "definition": classic(), "kind": "media", "id": "removeImage" }))).unwrap();

    assert_eq!(d["media"]["image"], Value::Null);
}
