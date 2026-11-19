// A song slide laid out to the glyph, for a shell that draws it itself (docs/native-slide-rendering.md, way 3): the
// theme's background, and its main text and credits as the web's SlideView sets them (apps/web/src/ui/SlideView.tsx,
// FittedText.tsx), each line where it starts and each glyph where it stands on the 1920 × 1080 stage. The shell paints
// that list with the same faces (fonts/, the app's own as TrueType) and its own means. Laid out with parley over those
// faces only, with Chromium's break opportunities on ASCII pairs, which WebKit shares where songs need them
// (spike/slide-layout/README.md: the same lines as the browsers on 99.7–100 % of 12 916 real slides).
use crate::args::*;
use parley::fontique::{Blob, FontInfoOverride};
use parley::{
    FontContext, FontFamily, FontWeight, Layout, LayoutContext, LineHeight, OverflowWrap, PositionedLayoutItem,
    StyleProperty, CHROMIUM_LINE_BREAK_OVERRIDE,
};
use serde_json::{json, Value};
use std::cell::RefCell;
use std::sync::Arc;

/// The faces the app ships (apps/web/src/assets/fonts), as TrueType: `woff2_decompress` of those files, named as the
/// web's `@font-face` names them (a variable file's own name is its default instance's: "Montserrat Thin").
const FACES: [(&str, &[u8]); 3] = [
    ("Inter", include_bytes!("../fonts/Inter-variable.ttf")),
    ("Montserrat", include_bytes!("../fonts/Montserrat-variable.ttf")),
    ("Lato", include_bytes!("../fonts/Lato-400.ttf")),
];

/// The stage every slide is drawn on, scaled to its box (themes.ts's CANVAS).
const STAGE: (f32, f32) = (1920.0, 1080.0);
/// The smallest a main text is made, of its theme's size (FittedText's MIN_SCALE).
const MIN_SCALE: f32 = 0.35;

struct Engine {
    fonts: FontContext,
    layouts: LayoutContext<()>,
    /// Each face's blob, to name the face a glyph run was shaped with.
    blobs: Vec<u64>,
}

thread_local! {
    /// The faces registered once (they are read on first use), and parley's scratch space.
    static ENGINE: RefCell<Option<Engine>> = const { RefCell::new(None) };
}

fn with_engine<T>(f: impl FnOnce(&mut Engine) -> T) -> T {
    ENGINE.with(|cell| {
        let mut cell = cell.borrow_mut();
        let engine = cell.get_or_insert_with(|| {
            let mut fonts = FontContext::new();
            let blobs = FACES
                .iter()
                .map(|&(family, bytes)| {
                    let blob = Blob::new(Arc::new(bytes));
                    let named = FontInfoOverride { family_name: Some(family), ..Default::default() };
                    fonts.collection.register_fonts(blob.clone(), Some(named));
                    blob.id()
                })
                .collect();
            Engine { fonts, layouts: LayoutContext::new(), blobs }
        });
        f(engine)
    })
}

/// A theme's text style (themes.ts's TextStyle), as far as it moves or paints the text.
struct Style {
    size: f32,
    face: &'static str,
    weight: f32,
    line_height: f32,
    align: f32,
    valign: f32,
    uppercase: bool,
    area: [f32; 4],
    paint: Value,
}

fn number(o: &Obj, k: &str) -> R<f32> { o.get(k).and_then(Value::as_f64).map(|n| n as f32).ok_or_else(|| "invalid-args".into()) }

/// The first face of a CSS font stack the core has: `'Inter', sans-serif` is Inter; Classic's Tahoma is none.
fn face_of(stack: &str) -> Option<&'static str> {
    stack.split(',').map(|f| f.trim().trim_matches(|c| c == '\'' || c == '"')).find_map(|f| FACES.iter().find(|(name, _)| name.eq_ignore_ascii_case(f)).map(|(name, _)| *name))
}

fn style(o: &Obj) -> R<Style> {
    let stack = o.get("fontFamily").and_then(Value::as_str).ok_or("invalid-args")?;
    let area = obj(o.get("area").ok_or("invalid-args")?)?;
    let at = |s: &str, options: [&str; 3]| options.iter().position(|o| *o == s).map(|i| i as f32 / 2.0);
    Ok(Style {
        size: number(o, "fontSize")?,
        face: face_of(stack).ok_or("font-not-shipped")?,
        weight: number(o, "fontWeight")?,
        line_height: number(o, "lineHeight")?,
        align: at(&one_of(o, "align", &["left", "center", "right"])?, ["left", "center", "right"]).unwrap_or(0.0),
        valign: at(&one_of(o, "valign", &["top", "middle", "bottom"])?, ["top", "middle", "bottom"]).unwrap_or(0.0),
        uppercase: boolean(o, "uppercase")?,
        area: [number(area, "x")?, number(area, "y")?, number(area, "w")?, number(area, "h")?],
        paint: json!({
            "color": o.get("color"), "shadow": o.get("shadow"), "outline": o.get("outline"), "outlineColor": o.get("outlineColor"),
        }),
    })
}

/// The text at `size`, broken to the area's width when `wrap`: white space kept and a word too long for a line broken
/// where it must be, as `.slide-text` sets it (styles.css).
fn layout(e: &mut Engine, text: &str, s: &Style, size: f32, wrap: bool) -> Layout<()> {
    // Not quantised to whole pixels: lines as far apart as the browser sets them (64 px at 1.6 is 102.4 apart, not 102).
    let mut b = e.layouts.ranged_builder(&mut e.fonts, text, 1.0, false);
    b.set_line_break_override(Some(&CHROMIUM_LINE_BREAK_OVERRIDE));
    b.push_default(StyleProperty::FontFamily(FontFamily::named(s.face)));
    b.push_default(StyleProperty::FontWeight(FontWeight::new(s.weight)));
    b.push_default(StyleProperty::FontSize(size));
    b.push_default(StyleProperty::LineHeight(LineHeight::FontSizeRelative(s.line_height)));
    b.push_default(StyleProperty::OverflowWrap(OverflowWrap::BreakWord));
    let mut l = b.build(text);
    l.break_all_lines(wrap.then_some(s.area[2]));
    l
}

/// FittedText's size: the theme's if the text fits its area, else halved between 35 % and all of it eight times while
/// it is taller (as offsetHeight rounds it, and a pixel), then rounded down.
fn fitted(e: &mut Engine, text: &str, s: &Style) -> f32 {
    let mut fits = |size: f32| layout(e, text, s, size, true).height().round() <= s.area[3] + 1.0;
    if fits(s.size) {
        return s.size;
    }
    let (mut lo, mut hi) = (MIN_SCALE, 1.0f32);
    for _ in 0..8 {
        let mid = (lo + hi) / 2.0;
        if fits(s.size * mid) { lo = mid } else { hi = mid }
    }
    (s.size * lo).floor()
}

fn r2(v: f32) -> f64 { (f64::from(v) * 100.0).round() / 100.0 }

/// A laid-out text as the shell paints it: its lines (each one's text, start, baseline and width), its glyph runs by
/// face, every position on the stage, and the area it is clipped to.
fn painted(e: &Engine, text: &str, l: &Layout<()>, s: &Style, size: f32, role: &str) -> Value {
    let top = s.area[1] + (s.area[3] - l.height()) * s.valign;
    let (mut lines, mut runs) = (Vec::new(), Vec::new());
    for line in l.lines() {
        let m = line.metrics();
        let width = m.advance - m.hanging_advance;
        let left = s.area[0] + (s.area[2] - width) * s.align;
        let range = line.text_range();
        lines.push(json!({ "text": text[range.clone()].trim_end_matches(['\n', '\r']), "x": r2(left), "y": r2(top + m.baseline), "width": r2(width) }));
        for item in line.items() {
            let PositionedLayoutItem::GlyphRun(run) = item else { continue };
            let face = e.blobs.iter().position(|id| *id == run.run().font().data.id()).map_or("", |i| FACES[i].0);
            let glyphs: Vec<Value> = run.positioned_glyphs().map(|g| json!([g.id, r2(left + g.x), r2(top + g.y)])).collect();
            runs.push(json!({ "face": face, "size": r2(run.run().font_size()), "glyphs": glyphs }));
        }
    }
    let [x, y, w, h] = s.area;
    json!({
        "role": role, "face": s.face, "weight": s.weight, "size": size, "lineHeight": s.line_height, "paint": s.paint,
        "clip": { "x": x, "y": y, "w": w, "h": h }, "lines": lines, "runs": runs,
    })
}

/// The credits on one line, cut with an ellipsis where they are wider than their area (`.slide-credits`).
fn credits(e: &mut Engine, text: &str, s: &Style) -> Value {
    let whole = layout(e, text, s, s.size, false);
    if whole.width() <= s.area[2] {
        return painted(e, text, &whole, s, s.size, "credits");
    }
    let chars: Vec<char> = text.chars().collect();
    let cut = |n: usize| format!("{}…", chars[..n].iter().collect::<String>().trim_end());
    let (mut lo, mut hi) = (0, chars.len());
    while lo < hi {
        let mid = (lo + hi).div_ceil(2);
        if layout(e, &cut(mid), s, s.size, false).width() <= s.area[2] { lo = mid } else { hi = mid - 1 }
    }
    let shown = cut(lo);
    let l = layout(e, &shown, s, s.size, false);
    painted(e, &shown, &l, s, s.size, "credits")
}

/// `slideLayoutView` {slide, theme}: a song slide's background, main text and credits laid out on the stage, the label
/// left to the shell (an operator's mark, LIVE-R20). Refused: `font-not-shipped` for a face the core does not have
/// (Classic's Tahoma), `not-yet` for a Bible, picture, video or custom slide.
pub fn view(a: &Obj) -> R<Value> {
    let slide = obj(a.get("slide").ok_or("invalid-args")?)?;
    if slide.get("kind").and_then(Value::as_str) != Some("song") || slide.get("custom").is_some_and(|c| !c.is_null()) {
        return Err("not-yet".into());
    }
    let theme = obj(a.get("theme").ok_or("invalid-args")?)?;
    let def = obj(obj(theme.get("definition").ok_or("invalid-args")?)?.get("song").ok_or("invalid-args")?)?;
    let (main, foot) = (style(obj(def.get("main").ok_or("invalid-args")?)?)?, style(obj(def.get("credits").ok_or("invalid-args")?)?)?);
    let raw = slide.get("text").and_then(Value::as_str).ok_or("invalid-args")?;
    let text = if main.uppercase { raw.to_uppercase() } else { raw.to_string() };
    with_engine(|e| {
        let size = fitted(e, &text, &main);
        let l = layout(e, &text, &main, size, true);
        let mut texts = vec![painted(e, &text, &l, &main, size, "main")];
        if let Some(c) = slide.get("credits").and_then(Value::as_str).filter(|c| !c.is_empty()) {
            texts.push(credits(e, &if foot.uppercase { c.to_uppercase() } else { c.to_string() }, &foot));
        }
        Ok(json!({ "width": STAGE.0, "height": STAGE.1, "background": def.get("background"), "texts": texts }))
    })
}
