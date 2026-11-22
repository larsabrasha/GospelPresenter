// How a presentation's page stands in a window of a size (docs/layout-2-0.md; the web's useWide.ts and PhoneLive.tsx's
// landscape classes; the core's since 2026-11-22 for the native shells): columns from about 1 000 points wide (a
// computer, an iPad lying down, a 13-inch iPad upright), else one column; a phone lying down while presenting has two,
// the running order at the left and the picture with its buttons at the right, 45 % of the width (Lars, 2026-11-02).
use crate::args::*;
use serde_json::{json, Value};

/// From this width a page has columns.
const COLUMNS: f64 = 1000.0;
/// Lying down, the live picture's column's share of the width.
const LIVE_SHARE: f64 = 0.45;

/// `pageLayoutView` {width, height, presenting}: {layout: "columns" | "one", live: "top" | "trailing" | null,
/// liveShare}: where the live picture stands in one column (above the running order upright, at the right lying down),
/// none before presenting or in columns (the live column's).
pub fn view(a: &Obj) -> R<Value> {
    let num = |k: &str| a.get(k).and_then(Value::as_f64).ok_or_else(|| "invalid-args".to_string());
    let (width, height) = (num("width")?, num("height")?);
    let presenting = a.get("presenting").and_then(Value::as_bool).unwrap_or(false);
    if width >= COLUMNS { return Ok(json!({ "layout": "columns", "live": null, "liveShare": null })) }
    let live = presenting.then(|| if width > height { "trailing" } else { "top" });
    Ok(json!({ "layout": "one", "live": live, "liveShare": if live == Some("trailing") { json!(LIVE_SHARE) } else { Value::Null } }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(width: f64, height: f64, presenting: bool) -> Value {
        view(json!({ "width": width, "height": height, "presenting": presenting }).as_object().unwrap()).unwrap()
    }

    #[test]
    fn a_computer_has_columns() {
        assert_eq!(at(1440.0, 900.0, true)["layout"], json!("columns"));
    }

    #[test]
    fn a_phone_upright_has_the_picture_above_the_order() {
        assert_eq!(at(440.0, 956.0, true)["live"], json!("top"));
    }

    #[test]
    fn a_phone_lying_down_has_the_picture_at_the_right() {
        let out = at(956.0, 440.0, true);

        assert_eq!(out["layout"], json!("one"));
        assert_eq!(out["live"], json!("trailing"));
        assert_eq!(out["liveShare"], json!(0.45));
    }

    #[test]
    fn before_presenting_there_is_no_picture() {
        assert_eq!(at(956.0, 440.0, false)["live"], Value::Null);
    }

    #[test]
    fn an_ipad_lying_down_has_columns() {
        assert_eq!(at(1180.0, 820.0, true)["layout"], json!("columns"));
    }
}
