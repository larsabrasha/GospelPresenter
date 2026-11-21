// The theme editor as every shell draws it (the web's theme-editor/ThemeInspector.tsx and themeModel.ts): which kinds
// of slide it shows a theme on and the sample slide of each, what its Format panel holds for the part picked (the
// kind's background, or its main text's or credits' look) with each control's range and value, and each change made
// to a definition, checked as `updateTheme` checks it. A shell draws the controls and the sample (slideLayoutView) and
// keeps Ångra's history of whole definitions; how a control looks is its own.
use crate::args::*;
use serde_json::{json, Map, Value};

/// The stage (themes.ts's CANVAS).
const W: f64 = 1920.0;
const H: f64 = 1080.0;

/// The faces a theme's text may take, as the web offers them: its CSS stack and its name.
const FONTS: [(&str, &str); 4] = [
    ("'Tahoma', 'Geneva', Verdana, sans-serif", "Tahoma"),
    ("'Inter', sans-serif", "Inter"),
    ("'Lato', sans-serif", "Lato"),
    ("'Montserrat', sans-serif", "Montserrat"),
];

/// The slide the editor shows a kind on (themeModel.ts's SAMPLES): a song part, a Bible reading, a picture's stage.
fn sample(kind: &str) -> Value {
    match kind {
        "song" => json!({ "key": "sample-song", "kind": "song", "image": null, "text": "Amazing grace\nhow sweet the sound\nthat saved a wretch like me",
                          "verses": null, "label": null, "credits": "John Newton · 1779" }),
        "bible" => json!({ "key": "sample-bible", "kind": "bible", "image": null, "text": "",
                           "verses": [{ "n": 16, "t": "Ty så älskade Gud världen, att han utgav sin enfödde Son, på det att var och en som tror på honom skall icke förgås, utan hava evigt liv." }],
                           "label": null, "credits": "Johannes 3:16 · Bibel 1917" }),
        _ => json!({ "key": "sample-media", "kind": "media", "image": null, "text": "", "verses": null, "label": null, "credits": null }),
    }
}

/// A CSS colour as the editor shows it: `#rrggbb` and how opaque, 0–100 (themeModel.ts's `splitColor`).
pub fn split_color(css: &str) -> (String, i64) {
    let c = css.trim();
    let hex = |h: &str| h.len() == 3 || h.len() == 6;
    if let Some(h) = c.strip_prefix('#').filter(|h| hex(h) && h.chars().all(|x| x.is_ascii_hexdigit())) {
        let full: String = if h.len() == 3 { h.chars().flat_map(|x| [x, x]).collect() } else { h.to_string() };
        return (format!("#{}", full.to_lowercase()), 100);
    }
    let inner = c.strip_prefix("rgba(").or_else(|| c.strip_prefix("rgb(")).and_then(|r| r.strip_suffix(')'));
    let parts: Vec<&str> = inner.map(|i| i.split(',').map(str::trim).collect()).unwrap_or_default();
    let byte = |p: &str| p.parse::<u32>().ok().filter(|_| p.len() <= 3).map(|n| n.min(255));
    match (parts.len(), parts.first().and_then(|p| byte(p)), parts.get(1).and_then(|p| byte(p)), parts.get(2).and_then(|p| byte(p))) {
        (3 | 4, Some(r), Some(g), Some(b)) => {
            let a = parts.get(3).and_then(|p| p.parse::<f64>().ok()).unwrap_or(1.0).min(1.0);
            (format!("#{r:02x}{g:02x}{b:02x}"), (a * 100.0).round() as i64)
        }
        _ => ("#ffffff".into(), 100),
    }
}

/// `hex` at `alpha` %: the hex itself when opaque, else `rgba(…)` (themeModel.ts's `joinColor`).
pub fn join_color(hex: &str, alpha: i64) -> String {
    if alpha >= 100 { return hex.to_string() }
    let n = u32::from_str_radix(hex.trim_start_matches('#'), 16).unwrap_or(0xffffff);
    let a = alpha.max(0) as f64 / 100.0;
    format!("rgba({}, {}, {}, {})", (n >> 16) & 255, (n >> 8) & 255, n & 255, crate::json::J::Num(a).stringify())
}

/// A box kept on the stage and within the schema's bounds, in whole pixels (themeModel.ts's `clampArea`).
fn clamp_area(a: &Value) -> Value {
    let f = |k: &str| a[k].as_f64().unwrap_or(0.0);
    let w = W.min(40f64.max(f("w"))).round();
    let h = H.min(40f64.max(f("h"))).round();
    let x = (W - 40.0).min(0f64.max(f("x").min(W - w))).round();
    let y = (H - 40.0).min(0f64.max(f("y").min(H - h))).round();
    json!({ "x": x as i64, "y": y as i64, "w": w as i64, "h": h as i64 })
}

fn control(id: &str, kind: &str, text: &str, value: Value) -> Value { json!({ "id": id, "kind": kind, "text": text, "value": value }) }

fn slider(id: &str, text: &str, value: Value, min: i64, max: i64) -> Value {
    let mut c = control(id, "slider", text, value);
    c["min"] = json!(min);
    c["max"] = json!(max);
    c
}

fn segments(id: &str, text: &str, value: &str, options: &[(&str, &str)]) -> Value {
    let mut c = control(id, "segments", text, json!(value));
    c["options"] = Value::Array(options.iter().map(|(v, t)| json!({ "id": v, "text": t })).collect());
    c
}

fn group(title: Option<Value>, controls: Vec<Value>) -> Value { json!({ "title": title, "controls": controls }) }

/// `themeEditorView` {definition, kind, picked}: the kinds to show a theme on (`kinds`), the sample slide of `kind`,
/// and the Format panel's groups for what is picked (`main`, `credits`, or none: the kind's background; a picture's
/// stage has no text). Each control's `id` is what `themeEditView` changes, its `kind` (slider, segments, picker,
/// color, colorAlpha, switches, picture, action), its text's key, its value and range; a slider's line height is in
/// tenths, as the web's.
pub fn view(a: &Obj) -> R<Value> {
    let def = a.get("definition").ok_or("invalid-args")?;
    let kind = a.get("kind").and_then(Value::as_str).filter(|k| ["song", "bible", "media"].contains(k)).ok_or("invalid-args")?;
    let picked = a.get("picked").and_then(Value::as_str).filter(|p| ["main", "credits"].contains(p) && kind != "media");
    let kinds = json!([{ "id": "song", "text": "themeEditor.song" }, { "id": "bible", "text": "themeEditor.bible" }, { "id": "media", "text": "themeEditor.media" }]);
    let groups = match picked {
        Some(role) => {
            let s = &def[kind][role];
            let weight = s["fontWeight"].as_f64().unwrap_or(400.0);
            let font = FONTS.iter().find(|f| s["fontFamily"] == f.0).unwrap_or(&FONTS[0]).0;
            let mut face = control("fontFamily", "picker", "themeEditor.font", json!(font));
            face["options"] = Value::Array(FONTS.iter().map(|(v, n)| json!({ "id": v, "name": n })).collect());
            let (hex, alpha) = split_color(s["color"].as_str().unwrap_or("#ffffff"));
            let mut colour = control("color", "colorAlpha", "slideEditor.color", json!({ "hex": hex, "alpha": alpha }));
            colour["alphaText"] = json!("themeEditor.opacity");
            colour["min"] = json!(10);
            let mut style = vec![slider("outline", "themeEditor.outline", s["outline"].clone(), 0, 10)];
            if s["outline"].as_f64().unwrap_or(0.0) > 0.0 {
                style.push(control("outlineColor", "color", "themeEditor.outlineColor", json!(split_color(s["outlineColor"].as_str().unwrap_or("#000000")).0)));
            }
            let mut switches = control("style", "switches", "slideEditor.style", Value::Null);
            switches["options"] = json!([{ "id": "uppercase", "text": "themeEditor.uppercase", "on": s["uppercase"] }, { "id": "shadow", "text": "themeEditor.shadow", "on": s["shadow"] }]);
            style.insert(0, switches);
            vec![
                group(Some(json!(if role == "main" { "themeEditor.mainText" } else { "themeEditor.credits" })), vec![
                    face,
                    slider("fontSize", "slideEditor.size", s["fontSize"].clone(), 20, if role == "main" { 200 } else { 100 }),
                    segments("fontWeight", "themeEditor.weight", if weight >= 700.0 { "700" } else if weight >= 500.0 { "600" } else { "400" },
                             &[("400", "themeEditor.regular"), ("600", "themeEditor.semibold"), ("700", "slideEditor.bold")]),
                    slider("lineHeight", "themeEditor.lineHeight", json!((s["lineHeight"].as_f64().unwrap_or(1.0) * 10.0).round() as i64), 8, 25),
                    segments("align", "slideEditor.align", s["align"].as_str().unwrap_or("center"), &[("left", "slideEditor.left"), ("center", "slideEditor.center"), ("right", "slideEditor.right")]),
                    segments("valign", "themeEditor.placement", s["valign"].as_str().unwrap_or("middle"), &[("top", "themeEditor.top"), ("middle", "themeEditor.middle"), ("bottom", "themeEditor.bottom")]),
                    colour,
                ]),
                group(None, style),
                group(None, vec![control("resetPlacement", "action", "themeEditor.resetPlacement", Value::Null)]),
            ]
        }
        None => {
            let bg = if kind == "media" { &def["media"] } else { &def[kind]["background"] };
            let has = !bg["image"].is_null();
            let mut controls = vec![
                control("color", "color", "slideEditor.color", json!(split_color(bg["color"].as_str().unwrap_or("#000000")).0)),
                control("image", "picture", if has { "slideEditor.replaceBackground" } else { "slideEditor.backgroundImage" }, bg["image"].clone()),
            ];
            if has {
                controls.push(segments("fit", "slideEditor.fit", bg["fit"].as_str().unwrap_or("cover"), &[("cover", "slideEditor.cover"), ("contain", "slideEditor.contain")]));
                controls.push(slider("scrim", "themeEditor.scrim", bg["scrim"].clone(), 0, 90));
                controls.push(control("removeImage", "action", "slideEditor.removeBackground", Value::Null));
            }
            vec![group(Some(json!({ "text": "themeEditor.backgroundOf", "kind": format!("themeEditor.{kind}") })), controls)]
        }
    };
    let hint = (kind != "media" && picked.is_none()).then_some("themeEditor.pickHint");
    Ok(json!({ "kinds": kinds, "sample": sample(kind), "groups": groups, "hint": hint,
               "area": picked.map_or(Value::Null, |p| def[kind][p]["area"].clone()) }))
}

/// `themeEditView` {definition, kind, picked, id, value}: the definition with one control's change (the ids
/// `themeEditorView` gives, and `area` for a box dragged on the stage, kept on it), checked as `updateTheme` checks a
/// definition: the next definition, or refused `invalid-args` for a value it may not take.
pub fn edit(a: &Obj) -> R<Value> {
    let mut def = a.get("definition").cloned().ok_or("invalid-args")?;
    let kind = a.get("kind").and_then(Value::as_str).filter(|k| ["song", "bible", "media"].contains(k)).ok_or("invalid-args")?;
    let picked = a.get("picked").and_then(Value::as_str).filter(|p| ["main", "credits"].contains(p) && kind != "media");
    let id = a.get("id").and_then(Value::as_str).ok_or("invalid-args")?;
    let value = a.get("value").cloned().unwrap_or(Value::Null);
    let mut patch = Map::new();
    match picked {
        Some(role) => match id {
            "fontFamily" | "align" | "valign" | "uppercase" | "shadow" | "fontSize" | "outline" => { patch.insert(id.into(), value); }
            "fontWeight" => { patch.insert(id.into(), json!(value.as_str().and_then(|v| v.parse::<i64>().ok()).or(value.as_i64()).ok_or("invalid-args")?)); }
            "lineHeight" => { patch.insert(id.into(), json!(value.as_f64().ok_or("invalid-args")? / 10.0)); }
            "color" => { patch.insert(id.into(), json!(join_color(value["hex"].as_str().ok_or("invalid-args")?, value["alpha"].as_i64().unwrap_or(100)))); }
            "outlineColor" => { patch.insert(id.into(), value); }
            "area" => { patch.insert(id.into(), clamp_area(&value)); }
            // Back where the dark theme has it (themeModel.ts's `defaultArea`), the main text in the middle, the credits at the foot.
            "resetPlacement" => {
                let classic = crate::themes::classic_definition();
                patch.insert("area".into(), classic[kind][role]["area"].clone());
                patch.insert("valign".into(), json!(if role == "main" { "middle" } else { "bottom" }));
            }
            _ => return Err("invalid-args".into()),
        },
        None => match id {
            "color" | "fit" | "scrim" | "image" => { patch.insert(id.into(), value); }
            "removeImage" => { patch.insert("image".into(), Value::Null); }
            _ => return Err("invalid-args".into()),
        },
    }
    // get_mut, not IndexMut: a definition of the wrong shape is refused, never a panic (which aborts the app).
    let target = match (picked, kind) {
        (Some(role), _) => def.get_mut(kind).and_then(|k| k.get_mut(role)),
        (None, "media") => def.get_mut("media"),
        (None, _) => def.get_mut(kind).and_then(|k| k.get_mut("background")),
    };
    let o = target.and_then(Value::as_object_mut).ok_or("invalid-args")?;
    for (k, v) in patch { o.insert(k, v); }
    let (checked, _) = crate::theme_def::definition(Some(&def))?;
    Ok(serde_json::from_str(&checked.stringify()).map_err(|_| "invalid-args")?)
}

#[cfg(test)]
#[path = "theme_editor_tests.rs"]
mod tests;
