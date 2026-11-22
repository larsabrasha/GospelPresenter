// Slides painted from the core's layout with cairo (docs/native-slide-rendering.md, way 3, as the Mac app paints them
// with Core Text in apps/mac/Sources/GPMac/SlidePainter.swift): every glyph where the core's slideLayoutView put it on
// the 1920 × 1080 stage, from the same faces (faces.rs), over the theme's ground; a page's shapes and pictures; the
// part's label on a tile; an overlay over all.
use crate::faces;
use crate::layout::{css_colour, Background, Item, Rect, Rgba, Run, SlideLayout, Text, BLACK, WHITE};
use cairo::{Context, FontOptions, Glyph, HintMetrics, HintStyle, Matrix};
use gtk::gdk::prelude::GdkCairoContextExt;
use gtk::gdk_pixbuf::Pixbuf;
use std::path::PathBuf;

/// The stage every slide is drawn on (themes.ts's CANVAS).
pub const STAGE: (f64, f64) = (1920.0, 1080.0);
/// How far a synthetic italic leans, as WebKit's and Skia's: a quarter of the height.
const OBLIQUE: f64 = 0.25;

/// A part's label as a tile shows it: its text and its colour.
pub struct Label {
    pub text: String,
    pub color: String,
}

fn set(cr: &Context, c: Rgba) { cr.set_source_rgba(c.0, c.1, c.2, c.3) }

fn colour(text: Option<&str>, or: Rgba) -> Rgba { text.and_then(css_colour).unwrap_or(or) }

/// Which parts of a slide are painted: all of it, or the slide alone and its overlay alone, with a video between them
/// (the Mac app's SlidePainter `Part`; SlideView's `slide-image` under `.slide-overlay`).
#[derive(Clone, Copy, PartialEq)]
pub enum Part { All, Slide, Overlay }

/// The slide in a box of `w` × `h`: the stage scaled to fit and centred, as SlideView's. A tile shows the label and no
/// credits, the live picture the credits and no label (apps/web/src/slides/main.tsx).
pub fn paint(cr: &Context, l: &SlideLayout, label: Option<&Label>, w: f64, h: f64) { paint_part(cr, l, label, w, h, Part::All) }

/// `paint`, of the part named.
pub fn paint_part(cr: &Context, l: &SlideLayout, label: Option<&Label>, w: f64, h: f64, part: Part) {
    let scale = (w / STAGE.0).min(h / STAGE.1);
    let _ = cr.save();
    cr.translate(((w - STAGE.0 * scale) / 2.0).round(), ((h - STAGE.1 * scale) / 2.0).round());
    cr.scale(scale, scale);
    cr.rectangle(0.0, 0.0, STAGE.0, STAGE.1);
    cr.clip();
    if part != Part::Overlay {
        if let Some(ground) = &l.background {
            set(cr, colour(ground.color.as_deref(), BLACK));
            let _ = cr.paint();
            theme_picture(cr, ground);
        }
        items(cr, &l.items);
        for t in l.texts.iter().filter(|t| label.is_none() || t.role != "credits") { text(cr, t) }
        // The label over the slide (`z-[1]`), an overlay over both (`.slide-overlay`, z-index 2).
        if let Some(label) = label { pill(cr, label) }
    }
    if part != Part::Slide { items(cr, &l.overlay) }
    let _ = cr.restore();
    if let Err(e) = cr.status() { eprintln!("gospel-presenter: a slide not painted: {e}") }
}

/// Where this device keeps media files by their hash: GP_MEDIA, else `media` beside a database named, else in the
/// app's data folder.
pub fn media_dir() -> PathBuf {
    std::env::var_os("GP_MEDIA").filter(|v| !v.is_empty()).map(PathBuf::from)
        .or_else(|| crate::db_given().map(|p| p.with_file_name("media")))
        .unwrap_or_else(|| crate::net::data_dir().join("media"))
}

/// A picture this device keeps, by its full file's hash, else its thumbnail's.
fn pixbuf(full: Option<&str>, thumb: Option<&str>) -> Option<Pixbuf> {
    [full, thumb].into_iter().flatten().find_map(|hash| Pixbuf::from_file(media_dir().join(hash)).ok())
}

/// A picture filling its box (`cover`) or fitted in it (`contain`), clipped to it.
fn picture(cr: &Context, p: &Pixbuf, at: Rect, fit: &str) {
    let (pw, ph) = (f64::from(p.width()), f64::from(p.height()));
    let k = if fit == "cover" { (at.w / pw).max(at.h / ph) } else { (at.w / pw).min(at.h / ph) };
    let _ = cr.save();
    cr.rectangle(at.x, at.y, at.w, at.h);
    cr.clip();
    cr.translate(at.x + (at.w - pw * k) / 2.0, at.y + (at.h - ph * k) / 2.0);
    cr.scale(k, k);
    cr.set_source_pixbuf(p, 0.0, 0.0);
    let _ = cr.paint();
    let _ = cr.restore();
}

/// A theme's own picture, filling or fitted, with its scrim (SlideView's ThemePicture); nothing while this device does
/// not have it.
fn theme_picture(cr: &Context, bg: &Background) {
    let Some(p) = bg.image.as_ref().filter(|p| p.kind == "picture") else { return };
    let Some(image) = pixbuf(p.full.as_deref(), p.thumb.as_deref()) else { return };
    picture(cr, &image, Rect { x: 0.0, y: 0.0, w: STAGE.0, h: STAGE.1 }, bg.fit.as_deref().unwrap_or("cover"));
    if let Some(scrim) = bg.scrim.filter(|s| *s > 0.0) {
        cr.set_source_rgba(0.0, 0.0, 0.0, scrim.min(100.0) / 100.0);
        let _ = cr.paint();
    }
}

/// A page's items in drawing order (slide_items.rs): fills, pictures, rectangles, ellipses, lines and texts.
fn items(cr: &Context, items: &[Item]) {
    for it in items {
        match it.kind.as_str() {
            "fill" => if let Some(at) = it.at {
                set(cr, colour(it.color.as_deref(), BLACK));
                cr.rectangle(at.x, at.y, at.w, at.h);
                let _ = cr.fill();
            },
            "picture" => if let (Some(at), Some(p)) = (it.at, pixbuf(it.full.as_deref(), it.thumb.as_deref())) {
                picture(cr, &p, at, it.fit.as_deref().unwrap_or("contain"));
            },
            "rect" | "ellipse" => if let Some(at) = it.at { shape(cr, it, at) },
            "line" => if let (Some(from), Some(to)) = (it.from, it.to) {
                set(cr, colour(it.stroke.as_deref(), WHITE));
                cr.set_line_width(it.width.unwrap_or(4.0));
                cr.set_line_cap(cairo::LineCap::Round);
                cr.move_to(from[0], from[1]);
                cr.line_to(to[0], to[1]);
                let _ = cr.stroke();
            },
            "text" => if let Some(t) = &it.text { text(cr, t) },
            _ => {}
        }
    }
}

/// A rectangle with rounded corners or an ellipse: its fill, then its border inside its edge.
fn shape(cr: &Context, it: &Item, at: Rect) {
    let stroke = it.stroke_width.unwrap_or(0.0);
    let outline = |inset: f64| {
        let (x, y, w, h) = (at.x + inset, at.y + inset, (at.w - 2.0 * inset).max(0.0), (at.h - 2.0 * inset).max(0.0));
        cr.new_path();
        if it.kind == "ellipse" {
            let _ = cr.save();
            cr.translate(x + w / 2.0, y + h / 2.0);
            cr.scale((w / 2.0).max(0.01), (h / 2.0).max(0.01));
            cr.arc(0.0, 0.0, 1.0, 0.0, std::f64::consts::TAU);
            let _ = cr.restore();
        } else {
            let r = (it.radius.unwrap_or(0.0) - inset).clamp(0.0, w.min(h) / 2.0);
            cr.new_sub_path();
            cr.arc(x + w - r, y + r, r, -std::f64::consts::FRAC_PI_2, 0.0);
            cr.arc(x + w - r, y + h - r, r, 0.0, std::f64::consts::FRAC_PI_2);
            cr.arc(x + r, y + h - r, r, std::f64::consts::FRAC_PI_2, std::f64::consts::PI);
            cr.arc(x + r, y + r, r, std::f64::consts::PI, 1.5 * std::f64::consts::PI);
            cr.close_path();
        }
    };
    if let Some(fill) = it.fill.as_deref().and_then(css_colour) {
        outline(0.0);
        set(cr, fill);
        let _ = cr.fill();
    }
    if let (Some(c), true) = (it.stroke.as_deref().and_then(css_colour), stroke > 0.0) {
        outline(stroke / 2.0);
        set(cr, c);
        cr.set_line_width(stroke);
        let _ = cr.stroke();
    }
}

/// The run's face at its size, its weight axis at `weight` (Inter's and Montserrat's variable files), slanted for an
/// italic, unhinted so the glyphs stand where the core put them.
fn font(cr: &Context, run: &Run, weight: f64, italic: bool) -> bool {
    let Some(face) = faces::face(&run.face) else { return false };
    cr.set_font_face(&face);
    let lean = if italic { -OBLIQUE * run.size } else { 0.0 };
    cr.set_font_matrix(Matrix::new(run.size, 0.0, lean, run.size, 0.0, 0.0));
    if let Ok(mut o) = FontOptions::new() {
        o.set_hint_style(HintStyle::None);
        o.set_hint_metrics(HintMetrics::Off);
        o.set_variations(Some(&format!("wght={weight}")));
        cr.set_font_options(&o);
    }
    true
}

/// A run's glyphs; each baseline on a whole pixel of the stage, as WebKit sets a line before the stage is scaled.
fn glyphs(run: &Run, dx: f64, dy: f64) -> Vec<Glyph> {
    run.glyphs.iter().map(|g| Glyph::new(g[0] as u64, g[1] + dx, g[2].round() + dy)).collect()
}

/// A text's glyphs where the core put them, clipped to its box: its shadow, its outline under its fill (`paint-order:
/// stroke fill`), each run at its opacity, a bold the face lacks drawn twice as WebKit draws it.
fn text(cr: &Context, t: &Text) {
    let _ = cr.save();
    cr.rectangle(t.clip.x, t.clip.y, t.clip.w, t.clip.h);
    cr.clip();
    let italic = t.italic == Some(true);
    let fill = colour(t.paint.color.as_deref(), WHITE);
    let outline = t.paint.outline.filter(|o| *o > 0.0).map(|o| (o, colour(t.paint.outline_color.as_deref(), BLACK)));
    if t.paint.shadow == Some(true) { shadow(cr, t, italic) }
    for run in &t.runs {
        if !font(cr, run, t.weight, italic) { continue }
        let _ = cr.save();
        if run.opacity.is_some() { cr.push_group() }
        let mut passes = vec![0.0];
        if run.bold == Some(true) { passes.push((run.size / 24.0).ceil()) }
        for dx in passes {
            let gs = glyphs(run, dx, 0.0);
            if let Some((width, c)) = outline {
                cr.glyph_path(&gs);
                set(cr, c);
                cr.set_line_width(width * 2.0);
                cr.set_line_join(cairo::LineJoin::Round);
                let _ = cr.stroke();
            }
            set(cr, fill);
            let _ = cr.show_glyphs(&gs);
        }
        if let Some(opacity) = run.opacity {
            let _ = cr.pop_group_to_source();
            let _ = cr.paint_with_alpha(opacity);
        }
        let _ = cr.restore();
    }
    let _ = cr.restore();
}

/// themes.ts's TEXT_SHADOW, `0 0.06em 0.18em rgba(0, 0, 0, 0.65)`: cairo has no blur, so the glyphs are drawn faintly
/// at points around the shadow's offset, spread as the blur spreads it. Close to the browser's, not the same pixels.
fn shadow(cr: &Context, t: &Text, italic: bool) {
    let (down, spread) = (0.06 * t.size, 0.09 * t.size);
    let mut at = vec![(0.0, down)];
    for i in 0..8 {
        let a = f64::from(i) * std::f64::consts::TAU / 8.0;
        at.push((spread * a.cos(), down + spread * a.sin()));
    }
    cr.push_group();
    for run in &t.runs {
        if !font(cr, run, t.weight, italic) { continue }
        for (dx, dy) in &at {
            cr.set_source_rgba(0.0, 0.0, 0.0, 1.0 / at.len() as f64 * 2.0);
            let _ = cr.show_glyphs(&glyphs(run, *dx, *dy));
        }
    }
    let _ = cr.pop_group_to_source();
    let _ = cr.paint_with_alpha(0.65 / 2.0 * 1.6);
}

/// The part's label at the stage's top right, as SlideView's: `top-6 right-10 rounded-full px-8 py-1`, the app's sans
/// at 48 px, line height 1.5, semibold, white on the label's colour.
fn pill(cr: &Context, label: &Label) {
    let layout = pangocairo::functions::create_layout(cr);
    let mut font = gtk::pango::FontDescription::from_string("sans-serif Semi-Bold");
    font.set_absolute_size(48.0 * f64::from(gtk::pango::SCALE));
    layout.set_font_description(Some(&font));
    layout.set_text(&label.text);
    let (_, logical) = layout.pixel_extents();
    let (w, h) = (f64::from(logical.width()) + 64.0, 48.0 * 1.5 + 8.0);
    let (x, y) = (STAGE.0 - 40.0 - w, 24.0);
    set(cr, colour(Some(&label.color), BLACK));
    cr.new_sub_path();
    cr.arc(x + h / 2.0, y + h / 2.0, h / 2.0, std::f64::consts::FRAC_PI_2, 1.5 * std::f64::consts::PI);
    cr.arc(x + w - h / 2.0, y + h / 2.0, h / 2.0, -std::f64::consts::FRAC_PI_2, std::f64::consts::FRAC_PI_2);
    cr.close_path();
    let _ = cr.fill();
    set(cr, WHITE);
    cr.move_to(x + 32.0, y + 4.0 + (72.0 - f64::from(logical.height())) / 2.0);
    pangocairo::functions::show_layout(cr, &layout);
}

/// A slide's place before it is laid out, or where the core refused it: the stage in black.
pub fn empty(cr: &Context, w: f64, h: f64) {
    cr.set_source_rgb(0.0, 0.0, 0.0);
    cr.rectangle(0.0, 0.0, w, h);
    let _ = cr.fill();
}
