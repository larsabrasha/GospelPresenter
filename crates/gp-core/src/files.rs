// What the readers of files share (the ProPresenter and Bible imports): the bytes a shell hands over in JSON, text read
// as the web's TextDecoder reads it, and strings measured and cut in UTF-16 units, as the web's are.

/// Standard base64, with or without its padding: the bytes the shell hands over in JSON.
pub fn base64(s: &str) -> Option<Vec<u8>> {
    let value = |c: u8| -> Option<u32> {
        Some(match c { b'A'..=b'Z' => c - b'A', b'a'..=b'z' => c - b'a' + 26, b'0'..=b'9' => c - b'0' + 52, b'+' => 62, b'/' => 63, _ => return None } as u32)
    };
    let b = s.trim_end_matches('=').as_bytes();
    let mut out = Vec::with_capacity(b.len() * 3 / 4);
    for chunk in b.chunks(4) {
        if chunk.len() == 1 { return None }
        let mut n = 0u32;
        for (k, &c) in chunk.iter().enumerate() { n |= value(c)? << (18 - 6 * k) }
        out.push((n >> 16) as u8);
        if chunk.len() > 2 { out.push((n >> 8) as u8) }
        if chunk.len() > 3 { out.push(n as u8) }
    }
    Some(out)
}

/// UTF-8 as the web's TextDecoder reads it: a byte order mark dropped, a byte that is no character U+FFFD.
pub fn utf8(b: &[u8]) -> String {
    String::from_utf8_lossy(b.strip_prefix(&[0xef, 0xbb, 0xbf][..]).unwrap_or(b)).into_owned()
}

/// At most `max` UTF-16 units, as `slice` cuts; half a pair cut off is U+FFFD, as JSON from the core cannot carry it.
pub fn cut(s: String, max: usize) -> String {
    let u: Vec<u16> = s.encode_utf16().collect();
    if u.len() > max { String::from_utf16_lossy(&u[..max]) } else { s }
}

/// `parseInt(s, 10)`: JavaScript's white space skipped, a sign, ASCII digits; NaN when there are none.
pub fn parse_int(s: &str) -> f64 {
    let t = s.trim_start_matches(crate::args::is_js_space);
    let (sign, rest) = match t.as_bytes().first() { Some(b'-') => (-1.0, &t[1..]), Some(b'+') => (1.0, &t[1..]), _ => (1.0, t) };
    let digits: &str = &rest[..rest.bytes().take_while(u8::is_ascii_digit).count()];
    if digits.is_empty() { return f64::NAN }
    sign * digits.parse::<f64>().unwrap_or(f64::NAN)
}

/// A number as JSON from JavaScript has it: whole numbers as integers, NaN and infinities as null.
pub fn number(f: f64) -> serde_json::Value {
    if !f.is_finite() { return serde_json::Value::Null }
    if f.fract() == 0.0 && f.abs() < 9_007_199_254_740_992.0 { serde_json::json!(f as i64) } else { serde_json::json!(f) }
}
