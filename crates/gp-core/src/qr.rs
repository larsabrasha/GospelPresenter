// QR codes for links (spec 04 §7, §8, §9), made here so every shell draws the same and no service ever sees one: error
// correction M with a light border of two modules, as the web's QrCode.tsx makes them.
use crate::args::*;
use crate::view_types::QrCode;
use qrcodegen::{QrCode as Code, QrCodeEcc};
use serde_json::Value;

const BORDER: i32 = 2;

/// `qrView` {value}: the QR code of `value` (`QrCode`: its size and its rows of `1` and `0`).
pub fn view(a: &Obj) -> R<Value> {
    let value = a.get("value").and_then(Value::as_str).ok_or("invalid-args")?;
    let code = Code::encode_text(value, QrCodeEcc::Medium).map_err(|_| "too-long".to_string())?;
    let size = code.size() + 2 * BORDER;
    let rows = (0..size).map(|y| (0..size).map(|x| if code.get_module(x - BORDER, y - BORDER) { '1' } else { '0' }).collect()).collect();
    serde_json::to_value(QrCode { size: size as i64, rows }).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn qr(v: &str) -> QrCode { serde_json::from_value(view(json!({ "value": v }).as_object().unwrap()).unwrap()).unwrap() }

    #[test]
    fn a_short_link_is_a_version_two_code_with_its_border() {
        let out = qr("https://192.168.1.59:47843/display?token=abcdefghij");

        assert_eq!((out.size, out.rows.len(), out.rows[0].len()), (37, 37, 37));
    }

    #[test]
    fn the_border_is_light() {
        let out = qr("https://example.org/display");

        assert!(out.rows[0].chars().all(|c| c == '0') && out.rows[1].chars().all(|c| c == '0'));
    }

    #[test]
    fn a_finder_pattern_stands_at_the_top_left() {
        let out = qr("https://example.org/display");

        assert_eq!(&out.rows[2][2..9], "1111111");
    }
}
