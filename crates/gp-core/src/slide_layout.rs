// A song slide laid out to the glyph, for a shell that draws it itself (docs/native-slide-rendering.md, way 3): the
// theme's background, and its main text and credits as the web's SlideView sets them (apps/web/src/ui/SlideView.tsx,
// FittedText.tsx), each line where it starts and each glyph where it stands on the 1920 × 1080 stage. The shell paints
// that list with the same faces (fonts/, the app's own as TrueType, and those it added from its system) and its own
// means. Laid out with parley over those
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
use std::ops::Range;
use std::sync::{Arc, Mutex};

/// The faces the app ships (apps/web/src/assets/fonts), as TrueType: `woff2_decompress` of those files, named as the
/// web's `@font-face` names them (a variable file's own name is its default instance's: "Montserrat Thin").
const FACES: [(&str, &[u8]); 3] = [
    ("Inter", include_bytes!("../fonts/Inter-variable.ttf")),
    ("Montserrat", include_bytes!("../fonts/Montserrat-variable.ttf")),
    ("Lato", include_bytes!("../fonts/Lato-400.ttf")),
];

/// The stage every slide is drawn on, scaled to its box (themes.ts's CANVAS).
pub(crate) const STAGE: (f32, f32) = (1920.0, 1080.0);
/// The smallest a main text is made, of its theme's size (FittedText's MIN_SCALE).
const MIN_SCALE: f32 = 0.35;

/// The faces a shell adds from its system, for a family a theme names that the app does not ship: Classic's Tahoma on
/// a Mac, where the browser draws it with the system's (`add_face`). Each one's name for the runs, its family, its
/// bytes; one list for every thread, each thread's engine registering those it has not yet.
static ADDED: Mutex<Vec<Added>> = Mutex::new(Vec::new());
/// An added face: its name, its family, its bytes.
type Added = (String, String, Arc<Vec<u8>>);

/// A face of the system's for `family`, named `name` in the runs (its PostScript name, say): a stack's family the core
/// then lays out with, where none before it in the stack is had. Added once; a name added again is left as it was.
pub fn add_face(name: String, family: String, bytes: Vec<u8>) {
    let mut added = ADDED.lock().unwrap_or_else(|e| e.into_inner());
    if !added.iter().any(|(n, _, _)| *n == name) {
        added.push((name, family, Arc::new(bytes)));
    }
}

/// A shipped face's bytes by its name (a run's `face`), for the shell to paint the glyphs with the very same file.
pub fn shipped_face(name: &str) -> Option<&'static [u8]> { FACES.iter().find(|(n, _)| *n == name).map(|(_, bytes)| *bytes) }

pub(crate) struct Engine {
    fonts: FontContext,
    layouts: LayoutContext<()>,
    /// Each face's blob, its name for the runs and its family: the shipped faces, then those added.
    faces: Vec<(u64, String, String)>,
}

impl Engine {
    /// The faces added since this thread's engine last looked, registered.
    fn take_added(&mut self) {
        let added = ADDED.lock().unwrap_or_else(|e| e.into_inner());
        for (name, family, bytes) in added.iter().skip(self.faces.len() - FACES.len()) {
            let blob = Blob::new(bytes.clone());
            let named = FontInfoOverride { family_name: Some(family), ..Default::default() };
            self.fonts.collection.register_fonts(blob.clone(), Some(named));
            self.faces.push((blob.id(), name.clone(), family.clone()));
        }
    }

    /// The first family of a CSS font stack the core has, shipped or added: `'Inter', sans-serif` is Inter;
    /// Classic's `'Tahoma', 'Geneva', Verdana, sans-serif` is Tahoma where the shell added it, else none.
    fn family_of(&self, stack: &str) -> Option<String> {
        stack.split(',').map(|f| f.trim().trim_matches(|c| c == '\'' || c == '"')).find_map(|f| {
            self.faces.iter().find(|(_, _, family)| family.eq_ignore_ascii_case(f)).map(|(_, _, family)| family.clone())
        })
    }
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
            let faces = FACES
                .iter()
                .map(|&(family, bytes)| {
                    let blob = Blob::new(Arc::new(bytes));
                    let named = FontInfoOverride { family_name: Some(family), ..Default::default() };
                    fonts.collection.register_fonts(blob.clone(), Some(named));
                    (blob.id(), family.to_string(), family.to_string())
                })
                .collect();
            Engine { fonts, layouts: LayoutContext::new(), faces }
        });
        engine.take_added();
        f(engine)
    })
}

/// A theme's text style (themes.ts's TextStyle), as far as it moves or paints the text.
pub(crate) struct Style {
    pub(crate) size: f32,
    face: String,
    weight: f32,
    line_height: f32,
    align: f32,
    valign: f32,
    pub(crate) uppercase: bool,
    area: [f32; 4],
    paint: Value,
}

pub(crate) fn number(o: &Obj, k: &str) -> R<f32> { o.get(k).and_then(Value::as_f64).map(|n| n as f32).ok_or_else(|| "invalid-args".into()) }

pub(crate) fn style(e: &Engine, o: &Obj) -> R<Style> {
    let stack = o.get("fontFamily").and_then(Value::as_str).ok_or("invalid-args")?;
    let area = obj(o.get("area").ok_or("invalid-args")?)?;
    let at = |s: &str, options: [&str; 3]| options.iter().position(|o| *o == s).map(|i| i as f32 / 2.0);
    Ok(Style {
        size: number(o, "fontSize")?,
        face: e.family_of(stack).ok_or("font-not-shipped")?,
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
pub(crate) fn layout(e: &mut Engine, text: &str, small: &[Range<usize>], s: &Style, size: f32, wrap: bool) -> Layout<()> {
    // Not quantised to whole pixels: lines as far apart as the browser sets them (64 px at 1.6 is 102.4 apart, not 102).
    let mut b = e.layouts.ranged_builder(&mut e.fonts, text, 1.0, false);
    b.set_line_break_override(Some(&CHROMIUM_LINE_BREAK_OVERRIDE));
    b.push_default(StyleProperty::FontFamily(FontFamily::named(&s.face)));
    b.push_default(StyleProperty::FontWeight(FontWeight::new(s.weight)));
    b.push_default(StyleProperty::FontSize(size));
    b.push_default(StyleProperty::LineHeight(LineHeight::FontSizeRelative(s.line_height)));
    b.push_default(StyleProperty::OverflowWrap(OverflowWrap::BreakWord));
    // A Bible slide's verse numbers, `.verse-number`: half the size, and `line-height: 0`, so they never make a line
    // taller; raised when they are painted.
    for r in small {
        b.push(StyleProperty::FontSize(size * 0.5), r.clone());
        b.push(StyleProperty::LineHeight(LineHeight::Absolute(0.0)), r.clone());
    }
    let mut l = b.build(text);
    l.break_all_lines(wrap.then_some(s.area[2]));
    l
}

/// FittedText's size: the theme's if the text fits its area, else halved between 35 % and all of it eight times while
/// it is taller (as offsetHeight rounds it, and a pixel), then rounded down.
fn fitted(e: &mut Engine, text: &str, small: &[Range<usize>], s: &Style) -> f32 {
    let mut fits = |size: f32| layout(e, text, small, s, size, true).height().round() <= s.area[3] + 1.0;
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

pub(crate) fn r2(v: f32) -> f64 { (f64::from(v) * 100.0).round() / 100.0 }

/// A laid-out text as the shell paints it: its lines (each one's text, start, baseline and width), its glyph runs by
/// face, every position on the stage, and the area it is clipped to.
pub(crate) fn painted(e: &Engine, text: &str, small: &[Range<usize>], l: &Layout<()>, s: &Style, size: f32, role: &str) -> Value {
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
            let id = run.run().font().data.id();
            let face = e.faces.iter().find(|(blob, _, _)| *blob == id).map_or("", |(_, name, _)| name);
            // A verse number: `vertical-align: super` raises it a third of the text's size and a pixel, as Chromium and
            // WebKit do, and Tailwind's `sup { position: relative; top: -0.5em }` half its own size (a quarter of the
            // text's) more; drawn at 40 % (`.verse-number`'s opacity).
            let verse = small.iter().any(|r| r.contains(&run.run().text_range().start));
            let up = if verse { size / 3.0 + 1.0 + size * 0.25 } else { 0.0 };
            let glyphs: Vec<Value> = run.positioned_glyphs().map(|g| json!([g.id, r2(left + g.x), r2(top + g.y - up)])).collect();
            let mut r = json!({ "face": face, "size": r2(run.run().font_size()), "glyphs": glyphs });
            if verse { r["opacity"] = json!(0.4) }
            // A weight the face lacks (Lato is shipped at 400 only): the browser draws it bold itself, as the shell must.
            if run.run().synthesis().embolden() { r["bold"] = json!(true) }
            runs.push(r);
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
    let whole = layout(e, text, &[], s, s.size, false);
    if whole.width() <= s.area[2] {
        return painted(e, text, &[], &whole, s, s.size, "credits");
    }
    let chars: Vec<char> = text.chars().collect();
    let cut = |n: usize| format!("{}…", chars[..n].iter().collect::<String>().trim_end());
    let (mut lo, mut hi) = (0, chars.len());
    while lo < hi {
        let mid = (lo + hi).div_ceil(2);
        if layout(e, &cut(mid), &[], s, s.size, false).width() <= s.area[2] { lo = mid } else { hi = mid - 1 }
    }
    let shown = cut(lo);
    let l = layout(e, &shown, &[], s, s.size, false);
    painted(e, &shown, &[], &l, s, s.size, "credits")
}

/// A Bible slide's text as SlideView's BibleText makes it (`white-space: normal`): each verse after a space, its
/// number (a verse number's range in the text) and a no-break space before its words, every run of white space one space, none
/// at the ends; in capitals piece by piece, so the ranges hold.
fn bible_text(verses: &[Value], upper: bool) -> (String, Vec<Range<usize>>) {
    let mut text = String::new();
    let mut small = Vec::new();
    let mut add = |piece: &str, verse: bool, text: &mut String| {
        let start = text.len();
        let piece = if upper { piece.to_uppercase() } else { piece.to_string() };
        for c in piece.chars() {
            if matches!(c, ' ' | '\t' | '\n' | '\r' | '\u{c}') {
                if !text.is_empty() && !text.ends_with(' ') { text.push(' ') }
            } else {
                text.push(c)
            }
        }
        if verse && text.len() > start { small.push(start..text.len()) }
    };
    for (i, v) in verses.iter().enumerate() {
        if i > 0 { add(" ", false, &mut text) }
        if let Some(n) = v.get("n").filter(|n| !n.is_null()) {
            add(&n.to_string(), true, &mut text);
            // A no-break space (SlideView's), so a number never ends a line apart from its words.
            add("\u{a0}", false, &mut text);
        }
        add(v.get("t").and_then(Value::as_str).unwrap_or(""), false, &mut text);
    }
    if text.ends_with(' ') { text.pop(); }
    (text, small)
}

/// A song or Bible slide's ground, main text and credits.
fn text_slide(e: &mut Engine, slide: &Obj, def: &Obj) -> R<(Value, Vec<Value>)> {
    let (main, foot) = (style(e, obj(def.get("main").ok_or("invalid-args")?)?)?, style(e, obj(def.get("credits").ok_or("invalid-args")?)?)?);
    let raw = slide.get("text").and_then(Value::as_str).ok_or("invalid-args")?;
    let (text, small) = match slide.get("verses").and_then(Value::as_array) {
        Some(v) => bible_text(v, main.uppercase),
        None => (if main.uppercase { raw.to_uppercase() } else { raw.to_string() }, vec![]),
    };
    let size = fitted(e, &text, &small, &main);
    let l = layout(e, &text, &small, &main, size, true);
    let mut texts = vec![painted(e, &text, &small, &l, &main, size, "main")];
    if let Some(c) = slide.get("credits").and_then(Value::as_str).filter(|c| !c.is_empty()) {
        texts.push(credits(e, &if foot.uppercase { c.to_uppercase() } else { c.to_string() }, &foot));
    }
    Ok((def.get("background").cloned().unwrap_or(Value::Null), texts))
}

/// `slideLayoutView` {slide, theme, overlay}: a slide laid out on the stage for a shell that paints it, as SlideView
/// draws it, the label left to the shell (an operator's mark, LIVE-R20): its `background` (the theme's ground and
/// picture; none for no slide, a clear ground), `items` over it in drawing order (a picture slide's or a video's
/// still, a slideshow's page: its ground, pictures, shapes and texts, `slide_items.rs`), `texts` (a song or Bible
/// slide's main text, fitted, and its credits; a Bible slide's text flowing, its verse numbers small, raised and
/// faint), and `overlay`, an overlay's page over all (LIVE-R15). Refused `font-not-shipped` for a stack of which the
/// core has no face (Classic's Tahoma where no shell added it).
pub fn view(a: &Obj) -> R<Value> {
    let theme = obj(a.get("theme").ok_or("invalid-args")?)?;
    let def = obj(theme.get("definition").ok_or("invalid-args")?)?;
    let given = |k: &str| a.get(k).filter(|v| !v.is_null()).map(obj).transpose();
    let (slide, overlay) = (given("slide")?, given("overlay")?);
    with_engine(|e| {
        let (background, items, texts) = match slide {
            None => (Value::Null, vec![], vec![]),
            Some(s) => match s.get("custom").filter(|c| !c.is_null()) {
                Some(page) => crate::slide_items::custom(e, s, obj(page)?, def)?,
                None if s.get("kind").and_then(Value::as_str) == Some("media") => crate::slide_items::media(s, def)?,
                None => {
                    let kind = s.get("kind").and_then(Value::as_str).filter(|k| *k == "song" || *k == "bible").ok_or("invalid-args")?;
                    let (ground, texts) = text_slide(e, s, obj(def.get(kind).ok_or("invalid-args")?)?)?;
                    (ground, vec![], texts)
                }
            },
        };
        let over = match overlay { Some(o) => crate::slide_items::page(e, o, def)?, None => vec![] };
        Ok(json!({ "width": STAGE.0, "height": STAGE.1, "background": background, "items": items, "texts": texts, "overlay": over }))
    })
}
