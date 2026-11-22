use super::*;

/// Three tiles to a row, 100 wide and 60 high with gaps of 10, as a song's slides stand; `n` of them from row `row0`.
fn grid(item: &str, n: usize, row0: usize) -> Vec<Value> {
    (0..n).map(|i| {
        let left = (i % 3) as f64 * 110.0;
        let top = (row0 + i / 3) as f64 * 70.0;
        json!({ "key": format!("{item}/{i}"), "left": left, "top": top, "right": left + 100.0, "bottom": top + 60.0 })
    }).collect()
}

fn across(tiles: Vec<Value>, from: Option<&str>, dir: i64) -> Value {
    view(json!({ "tiles": tiles, "from": from, "dir": dir }).as_object().unwrap()).unwrap()["key"].clone()
}

#[test]
fn goes_to_the_slide_under_it_on_the_next_row() {
    assert_eq!(across(grid("A", 6, 0), Some("A/1"), 1), json!("A/4"));
}

#[test]
fn goes_to_the_slide_over_it_on_the_row_before() {
    assert_eq!(across(grid("A", 6, 0), Some("A/5"), -1), json!("A/2"));
}

#[test]
fn goes_to_the_nearest_one_across_on_a_shorter_row() {
    assert_eq!(across(grid("A", 4, 0), Some("A/2"), 1), json!("A/3"));
}

#[test]
fn goes_on_into_the_next_items_first_row() {
    let tiles = [grid("A", 3, 0), grid("B", 3, 2)].concat();

    assert_eq!(across(tiles, Some("A/0"), 1), json!("B/0"));
}

#[test]
fn stays_at_the_last_row_going_down() {
    assert_eq!(across(grid("A", 6, 0), Some("A/4"), 1), Value::Null);
}

#[test]
fn stays_at_the_first_row_going_up() {
    assert_eq!(across(grid("A", 6, 0), Some("A/1"), -1), Value::Null);
}

#[test]
fn starts_at_the_first_slide_going_down_from_nowhere() {
    assert_eq!(across(grid("A", 6, 0), None, 1), json!("A/0"));
}

#[test]
fn starts_at_the_last_slide_going_up_from_nowhere() {
    assert_eq!(across(grid("A", 6, 0), None, -1), json!("A/5"));
}

#[test]
fn takes_tops_a_few_points_apart_as_one_row() {
    let mut tiles = grid("A", 6, 0);
    tiles[4]["top"] = json!(73.0);

    assert_eq!(across(tiles, Some("A/0"), 1), json!("A/3"));
}

#[test]
fn a_single_column_steps_as_the_arrows_across_do() {
    let tiles: Vec<Value> = (0..3).map(|i| json!({ "key": format!("A/{i}"), "left": 0, "top": i * 70, "right": 100, "bottom": i * 70 + 60 })).collect();

    assert_eq!(across(tiles, Some("A/1"), 1), json!("A/2"));
}

#[test]
fn takes_the_first_of_two_as_near() {
    let tiles = vec![
        json!({ "key": "A/0", "left": 50, "top": 0, "right": 150, "bottom": 60 }),
        json!({ "key": "A/1", "left": 0, "top": 70, "right": 100, "bottom": 130 }),
        json!({ "key": "A/2", "left": 100, "top": 70, "right": 200, "bottom": 130 }),
    ];

    assert_eq!(across(tiles, Some("A/0"), 1), json!("A/1"));
}

#[test]
fn refuses_a_direction_other_than_one_step() {
    let out = view(json!({ "tiles": [], "from": null, "dir": 2 }).as_object().unwrap());

    assert!(out.is_err());
}
