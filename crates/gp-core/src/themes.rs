// The themes a presentation shows (packages/core/src/themes.ts): the two built in, the organisation's own, and which
// one a presentation gets (`resolveTheme`): its own, else the organisation's default, else Classic (THEME-R1).
use crate::bridge::sql;
use crate::rows::js_string;
use serde_json::{json, Value};

const TAHOMA: &str = "'Tahoma', 'Geneva', Verdana, sans-serif";

/// The product baseline every built-in theme starts from (LIVE-R18), and the credits one line at the foot; `with`
/// overrides fields of either.
fn text(credits: bool, with: &[(&str, Value)]) -> Value {
    let mut t = json!({
        "fontSize": 75, "fontFamily": TAHOMA, "fontWeight": 400, "lineHeight": 1.4, "color": "#ffffff", "align": "center",
        "shadow": false, "uppercase": false, "outline": 0, "outlineColor": "#000000",
        "area": { "x": 80, "y": 80, "w": 1760, "h": 856 }, "valign": "middle",
    });
    if credits {
        for (k, v) in [("fontSize", json!(40)), ("lineHeight", json!(1.2)), ("color", json!("rgba(255, 255, 255, 0.4)")), ("align", json!("left")),
            ("area", json!({ "x": 80, "y": 936, "w": 1760, "h": 112 })), ("valign", json!("bottom"))] { t[k] = v }
    }
    for (k, v) in with { t[*k] = v.clone() }
    t
}

fn plain(color: &str) -> Value { json!({ "color": color, "image": null, "fit": "cover", "scrim": 0 }) }

fn style(background: Value, main: &[(&str, Value)], credits: &[(&str, Value)]) -> Value {
    json!({ "background": background, "main": text(false, main), "credits": text(true, credits) })
}

/// `BUILT_IN_THEMES`: Mörkt (Classic, the fallback) and Ljust.
fn built_in(id: &str) -> Option<Value> {
    let black = || json!("#000000");
    Some(match id {
        "classic" => json!({
            "id": "classic", "sort": 0, "name": "Mörkt",
            "description": "Fet vit text på svart bakgrund med luftigt radavstånd. Utseendet vi rekommenderar.",
            "definition": {
                "song": style(plain("#000000"), &[("fontWeight", json!(700))], &[]),
                "bible": style(plain("#000000"), &[("align", json!("left"))], &[]),
                "media": plain("#000000"),
            },
        }),
        "light" => {
            let credits = [("color", json!("rgba(0, 0, 0, 0.4)"))];
            json!({
                "id": "light", "sort": 1, "name": "Ljust",
                "description": "Som Mörkt, med svart text på vit bakgrund. För LED-vägg och ljusa lokaler.",
                "definition": {
                    "song": style(plain("#ffffff"), &[("fontWeight", json!(700)), ("color", black())], &credits),
                    "bible": style(plain("#ffffff"), &[("align", json!("left")), ("color", black())], &credits),
                    "media": plain("#000000"),
                },
            })
        }
        _ => return None,
    })
}

/// `parseThemeDefinition`: a stored definition as the schema reads it, or None where it does not read.
fn definition(text: &str) -> Option<Value> {
    let v: Value = serde_json::from_str(text).ok()?;
    let (def, _) = crate::theme_def::definition(Some(&v)).ok()?;
    serde_json::from_str(&def.stringify()).ok()
}

/// `themeView` {id}: the theme `id` (null: the organisation's default), as `themeOf` resolves it.
pub async fn view(a: &crate::args::Obj) -> crate::args::R<Value> { Ok(theme_of(crate::args::opt_id(a, "id")?).await) }

/// `themeOf`: the theme of a presentation whose theme is `theme_id` (None: the organisation's default).
pub async fn theme_of(theme_id: Option<String>) -> Value {
    let default = sql("SELECT value FROM org_settings WHERE id = ?", vec![json!("defaultThemeId")]).await
        .into_iter().next().and_then(|r| r[0].as_str().map(String::from));
    let id = theme_id.or(default).unwrap_or_else(|| "classic".into());
    if let Some(t) = built_in(&id) { return t }
    let own = sql("SELECT id, name, definition, sort FROM themes WHERE id = ?", vec![json!(id)]).await.into_iter().next();
    own.map_or_else(|| built_in("classic").unwrap(), |r| own_row(&r))
}

/// `themeOfRow` {id, name, definition, sort}: a definition that does not read looks as Classic, the name kept.
pub fn own_row(r: &[Value]) -> Value {
    json!({
        "id": js_string(&r[0]), "sort": r[3].as_f64().map_or(json!(0), |f| if f.fract() == 0.0 { json!(f as i64) } else { json!(f) }),
        "name": js_string(&r[1]), "description": "",
        "definition": r[2].as_str().and_then(definition).unwrap_or_else(|| built_in("classic").unwrap()["definition"].clone()),
    })
}
