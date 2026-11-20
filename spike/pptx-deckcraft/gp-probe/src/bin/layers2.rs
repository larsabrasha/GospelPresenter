//! layers2 DECK.pptx OUTDIR: every animated slide's builds as layers drawn once and put together per frame by an
//! affine move (offset, scale and rotation about the shape's centre), a fade and a clip, sampled bilinearly as a GPU
//! samples a texture; every frame compared with the slide drawn whole at the same moment, per slide and step.
use deckcraft_anim::{AnimState, ShowState, Timeline};
use deckcraft_geom::Vec2;
use deckcraft_model::resolve::{xfrm, Ctx};
use deckcraft_model::{Shape, ShapeId, ShapeKind};
use deckcraft_render::{render_slide, render_slide_part, Image, ParaState, RenderOpts, ShapeState, SlidePart};
use kurbo::{Affine, Point};

const SCALE: f64 = 1.0;
/// How much larger than the frame the animated layers are drawn (env LAYER, default 1).
static LAYER: std::sync::LazyLock<f64> = std::sync::LazyLock::new(|| std::env::var("LAYER").ok().and_then(|v| v.parse().ok()).unwrap_or(1.0));

fn to_state(s: AnimState, paras: Vec<(usize, ParaState)>) -> ShapeState {
    ShapeState { visible: s.visible, opacity: s.opacity, offset: Vec2::new(s.offset_x, s.offset_y), scale: (s.scale_x, s.scale_y), rotate: s.rotate, clip: s.clip, tint: s.tint, paras }
}
fn para(s: AnimState) -> ParaState { ParaState { visible: s.visible, opacity: s.opacity, offset: Vec2::new(s.offset_x, s.offset_y) } }
fn live(tl: &Timeline, id: ShapeId, step: usize, t: f64) -> ShapeState {
    to_state(tl.state(id, None, step, t), tl.paragraph_targets(id).into_iter().map(|p| (p, para(tl.state(id, Some(p), step, t)))).collect())
}
fn shown() -> AnimState { AnimState { visible: true, opacity: 1.0, ..AnimState::hidden() } }
fn opts<'a>(state: Option<&'a dyn Fn(ShapeId) -> ShapeState>) -> RenderOpts<'a> { RenderOpts { scale: SCALE, state, threads: 8, ..Default::default() } }

fn find(shapes: &[Shape], id: ShapeId) -> Option<&Shape> {
    shapes.iter().find_map(|s| if s.id == id { Some(s) } else if let ShapeKind::Group { children, .. } = &s.kind { find(children, id) } else { None })
}

/// Bilinear sample of premultiplied RGBA at pixel position (x, y), transparent outside.
fn sample(img: &Image, x: f64, y: f64) -> [f64; 4] {
    let (w, h) = (img.width as i64, img.height as i64);
    let (x0, y0) = ((x - 0.5).floor(), (y - 0.5).floor());
    let (fx, fy) = (x - 0.5 - x0, y - 0.5 - y0);
    let mut out = [0.0; 4];
    for (dx, dy, k) in [(0, 0, (1.0 - fx) * (1.0 - fy)), (1, 0, fx * (1.0 - fy)), (0, 1, (1.0 - fx) * fy), (1, 1, fx * fy)] {
        let (px, py) = (x0 as i64 + dx, y0 as i64 + dy);
        if px < 0 || py < 0 || px >= w || py >= h || k == 0.0 { continue }
        let i = ((py * w + px) * 4) as usize;
        for c in 0..4 { out[c] += img.pixels[i + c] as f64 * k }
    }
    out
}

/// `layer`, drawn at rest with the shape's transform `x`, laid over `frame` as the show has it: moved by `m`
/// (slide space, points), clipped to `clip` (the shape's unit space) and faded by `opacity`.
fn compose(frame: &mut Image, layer: &Image, x: Affine, m: Affine, w: f64, h: f64, clip: Option<[f64; 4]>, opacity: f64) {
    // A layer drawn larger than the frame (`LAYER`) is sampled at its own scale.
    let ls = layer.width as f64 / frame.width as f64 * SCALE;
    let inv = m.inverse();
    let (fw, fh) = (frame.width as usize, frame.height as usize);
    for py in 0..fh {
        for px in 0..fw {
            let p = Point::new((px as f64 + 0.5) / SCALE, (py as f64 + 0.5) / SCALE);
            let local = inv * p; // in the shape's own space
            if let Some([l, t, r, b]) = clip {
                if local.x < l * w || local.x > r * w || local.y < t * h || local.y > b * h { continue }
            }
            let src = x * local; // where it was drawn at rest
            let s = sample(layer, src.x * ls, src.y * ls);
            let a = s[3] * opacity / 255.0;
            if a <= 0.0 { continue }
            let i = (py * fw + px) * 4;
            for c in 0..4 {
                frame.pixels[i + c] = (s[c] * opacity + frame.pixels[i + c] as f64 * (1.0 - a)).round().clamp(0.0, 255.0) as u8;
            }
        }
    }
}

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let pres = deckcraft_pptx::import(&std::fs::read(&a[1]).expect("read")).expect("import");
    std::fs::create_dir_all(&a[2]).expect("dir");
    for si in 0..pres.slides.len() {
        let tl = ShowState::timeline(&pres, si);
        if tl.steps() == 0 { continue }
        let slide = &pres.slides[si];
        let ctx = Ctx::for_slide(&pres, slide).expect("ctx");
        let animated = tl.animated_shapes();
        let mut layers = vec![];
        for &id in &animated {
            let ps = tl.paragraph_targets(id);
            if ps.is_empty() { layers.push((id, None)) } else { layers.extend(ps.into_iter().map(|p| (id, Some(p)))) }
        }
        let backdrop = render_slide_part(&pres, si, SlidePart::Backdrop, &opts(None));
        let still_state = |id: ShapeId| if animated.contains(&id) { to_state(AnimState::hidden(), vec![]) } else { to_state(shown(), vec![]) };
        let still = render_slide_part(&pres, si, SlidePart::Content, &opts(Some(&still_state)));
        let pictures: Vec<Image> = layers.iter().map(|&(lid, lp)| {
            let only = |id: ShapeId| {
                if id != lid { return to_state(AnimState::hidden(), vec![]) }
                let paras = tl.paragraph_targets(id).into_iter().map(|p| (p, para(if Some(p) == lp { shown() } else { AnimState::hidden() }))).collect();
                to_state(shown(), paras)
            };
            let big = RenderOpts { scale: SCALE * *LAYER, state: Some(&only), threads: 8, ..Default::default() };
            render_slide_part(&pres, si, SlidePart::Content, &big)
        }).collect();

        for step in 0..tl.steps() {
            let len = tl.step_duration(step).max(0.1);
            let frames = (len * 30.0).ceil() as usize;
            let (mut worst, mut sum, mut tinted) = (0.0f64, 0.0, false);
            for f in 0..=frames {
                let t = len * f as f64 / frames as f64;
                let mut frame = backdrop.clone();
                compose(&mut frame, &still, Affine::IDENTITY, Affine::IDENTITY, 1e9, 1e9, None, 1.0);
                for ((id, p), pic) in layers.iter().zip(&pictures) {
                    let Some(shape) = find(&slide.shapes, *id) else { continue };
                    let x = xfrm(&ctx, shape);
                    let sh = tl.state(*id, None, step, t);
                    let (vis, op, off) = match p {
                        Some(p) => { let ps = tl.state(*id, Some(*p), step, t); (sh.visible && ps.visible, sh.opacity * ps.opacity, (sh.offset_x + ps.offset_x, sh.offset_y + ps.offset_y)) }
                        None => (sh.visible, sh.opacity, (sh.offset_x, sh.offset_y)),
                    };
                    if !vis || op <= 0.001 { continue }
                    tinted |= sh.tint.is_some();
                    let c = kurbo::Vec2::new(x.w / 2.0, x.h / 2.0);
                    let around = Affine::translate(c) * Affine::rotate(sh.rotate.to_radians()) * Affine::scale_non_uniform(sh.scale_x, sh.scale_y) * Affine::translate(-c);
                    let m = Affine::translate(kurbo::Vec2::new(off.0, off.1)) * x.affine() * around;
                    compose(&mut frame, pic, x.affine(), m, x.w, x.h, sh.clip, op.clamp(0.0, 1.0));
                }
                let whole_state = |id: ShapeId| live(&tl, id, step, t);
                let whole = render_slide(&pres, si, &opts(Some(&whole_state)));
                let px = frame.pixels.chunks(4).zip(whole.pixels.chunks(4)).filter(|(x, y)| x.iter().zip(y.iter()).any(|(p, q)| (*p as i32 - *q as i32).abs() > 24)).count();
                let share = 100.0 * px as f64 / (frame.width * frame.height) as f64;
                worst = worst.max(share);
                sum += share;
                // Every frame as Gospel Presenter would show it, the end of each click held 0.6 s (a pause before the next).
                if std::env::var("ALL").is_ok() {
                    let dir = format!("{}/film-s{}", a[2], si + 1);
                    std::fs::create_dir_all(&dir).ok();
                    let n = std::fs::read_dir(&dir).map(|d| d.count()).unwrap_or(0);
                    let png = frame.to_png();
                    let copies = if f == frames { 18 } else { 1 };
                    for k in 0..copies { std::fs::write(format!("{dir}/{:05}.png", n + k), &png).ok(); }
                }
                if f == frames / 2 {
                    std::fs::write(format!("{}/s{}-step{step}-layers.png", a[2], si + 1), frame.to_png()).expect("w");
                    std::fs::write(format!("{}/s{}-step{step}-whole.png", a[2], si + 1), whole.to_png()).expect("w");
                }
            }
            let effects: Vec<String> = tl.effects().iter().filter(|e| e.step == step).map(|e| format!("anim {} on shape {}", e.anim, e.shape)).collect();
            println!("slide {} step {step} {:?}: mean {:.2} %, worst {:.2} %{}", si + 1, effects, sum / (frames + 1) as f64, worst, if tinted { " (colour tint: not a layer's)" } else { "" });
        }
    }
}
