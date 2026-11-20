//! corpus FILE.pptx: one JSON line: whether DeckCraft reads it, how long drawing every slide takes, and for every
//! animated step how far its frames put together from layers drawn once (2× the frame) are from the slide drawn
//! whole, at 10 frames a second and 480×270 (quick; the method, not the sharpness, is what is asked).
use deckcraft_anim::{AnimState, ShowState, Timeline};
use deckcraft_geom::Vec2;
use deckcraft_model::resolve::{xfrm, Ctx};
use deckcraft_model::{Shape, ShapeId, ShapeKind};
use deckcraft_render::{render_slide, render_slide_part, Image, ParaState, RenderOpts, ShapeState, SlidePart};
use kurbo::{Affine, Point};
use std::time::Instant;

const SCALE: f64 = 0.5;
const LAYER: f64 = 2.0;

fn to_state(s: AnimState, paras: Vec<(usize, ParaState)>) -> ShapeState {
    ShapeState { visible: s.visible, opacity: s.opacity, offset: Vec2::new(s.offset_x, s.offset_y), scale: (s.scale_x, s.scale_y), rotate: s.rotate, clip: s.clip, tint: s.tint, paras }
}
fn para(s: AnimState) -> ParaState { ParaState { visible: s.visible, opacity: s.opacity, offset: Vec2::new(s.offset_x, s.offset_y) } }
fn live(tl: &Timeline, id: ShapeId, step: usize, t: f64) -> ShapeState {
    to_state(tl.state(id, None, step, t), tl.paragraph_targets(id).into_iter().map(|p| (p, para(tl.state(id, Some(p), step, t)))).collect())
}
fn shown() -> AnimState { AnimState { visible: true, opacity: 1.0, ..AnimState::hidden() } }
fn opts<'a>(scale: f64, state: Option<&'a dyn Fn(ShapeId) -> ShapeState>) -> RenderOpts<'a> { RenderOpts { scale, state, threads: 4, ..Default::default() } }
/// The shape `id` and its groups' transform to slide space, as the renderer composes it (`group_child_affine`).
fn find_in<'s>(ctx: &Ctx, shapes: &'s [Shape], id: ShapeId, parent: Affine) -> Option<(&'s Shape, Affine)> {
    for s in shapes {
        if s.id == id { return Some((s, parent)) }
        if let ShapeKind::Group { children, child } = &s.kind {
            let x = xfrm(ctx, s);
            let ch = kurbo::Rect::new(child.x, child.y, child.x + child.w, child.y + child.h);
            if let Some(hit) = find_in(ctx, children, id, parent * deckcraft_geom::group_child_affine(&x, ch)) { return Some(hit) }
        }
    }
    None
}

fn find(shapes: &[Shape], id: ShapeId) -> Option<&Shape> {
    shapes.iter().find_map(|s| if s.id == id { Some(s) } else if let ShapeKind::Group { children, .. } = &s.kind { find(children, id) } else { None })
}
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
fn compose(frame: &mut Image, layer: &Image, x: Affine, m: Affine, w: f64, h: f64, clip: Option<[f64; 4]>, opacity: f64) {
    if frame.width == 0 || layer.width == 0 { return }
    let ls = layer.width as f64 / frame.width as f64 * SCALE;
    let inv = m.inverse();
    let (fw, fh) = (frame.width as usize, frame.height as usize);
    for py in 0..fh {
        for px in 0..fw {
            let local = inv * Point::new((px as f64 + 0.5) / SCALE, (py as f64 + 0.5) / SCALE);
            if let Some([l, t, r, b]) = clip { if local.x < l * w || local.x > r * w || local.y < t * h || local.y > b * h { continue } }
            let src = x * local;
            let s = sample(layer, src.x * ls, src.y * ls);
            let a = s[3] * opacity / 255.0;
            if a <= 0.0 { continue }
            let i = (py * fw + px) * 4;
            for c in 0..4 { frame.pixels[i + c] = (s[c] * opacity + frame.pixels[i + c] as f64 * (1.0 - a)).round().clamp(0.0, 255.0) as u8 }
        }
    }
}
/// A layer: the shapes it shows, and the animated shape (and paragraph) it is, if any; `paras` its paragraph count.
struct Seg { visible: std::collections::HashSet<ShapeId>, anim: Option<(ShapeId, Option<usize>)>, paras: usize }

fn ids(s: &Shape, out: &mut Vec<ShapeId>) {
    out.push(s.id);
    if let ShapeKind::Group { children, .. } = &s.kind { for c in children { ids(c, out) } }
}

/// The layers of a slide bottom to top, by its top-level shapes' order. A group holding an animated shape is drawn
/// still without it, then its animated shapes above it (their order within the group is not kept).
fn segments(shapes: &[Shape], animated: &[ShapeId], tl: &Timeline) -> Vec<Seg> {
    let mut segs: Vec<Seg> = vec![];
    let mut still = std::collections::HashSet::new();
    let flush = |still: &mut std::collections::HashSet<ShapeId>, segs: &mut Vec<Seg>| if !still.is_empty() { segs.push(Seg { visible: std::mem::take(still), anim: None, paras: 0 }) };
    for top in shapes {
        let mut all = vec![];
        ids(top, &mut all);
        let moving: Vec<ShapeId> = all.iter().copied().filter(|i| animated.contains(i)).collect();
        if moving.is_empty() { still.extend(all); continue }
        // The group's still part, with its ancestors of the moving ones shown so their other children draw.
        if moving[0] != top.id { still.extend(all.iter().copied().filter(|i| !moving.contains(i))) }
        flush(&mut still, &mut segs);
        for id in moving {
            let Some(shape) = find(std::slice::from_ref(top), id) else { continue };
            let mut sub = vec![];
            ids(shape, &mut sub);
            let mut visible: std::collections::HashSet<ShapeId> = sub.into_iter().collect();
            visible.insert(top.id); // a group draws its children only if it is drawn
            let n = shape.text.as_ref().map_or(0, |t| t.paragraphs.len());
            let ps = tl.paragraph_targets(id);
            if ps.is_empty() {
                segs.push(Seg { visible, anim: Some((id, None)), paras: 0 });
            } else {
                if ps.len() < n { segs.push(Seg { visible: visible.clone(), anim: Some((id, None)), paras: n }) }
                for p in ps { segs.push(Seg { visible: visible.clone(), anim: Some((id, Some(p))), paras: n }) }
            }
        }
    }
    flush(&mut still, &mut segs);
    segs
}

fn esc(s: &str) -> String { serde_json_escape(s) }
fn serde_json_escape(s: &str) -> String { format!("{:?}", s) }

fn main() {
    let path = std::env::args().nth(1).expect("file");
    let name = std::path::Path::new(&path).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let bytes = std::fs::read(&path).expect("read");
    let t = Instant::now();
    let pres = match deckcraft_pptx::import(&bytes) {
        Ok(p) => p,
        Err(e) => { println!("{{\"file\":{},\"ok\":false,\"error\":{}}}", esc(&name), esc(&e.to_string())); return }
    };
    let import_ms = t.elapsed().as_secs_f64() * 1000.0;
    let t = Instant::now();
    for i in 0..pres.slides.len() { let _ = render_slide(&pres, i, &opts(1.0, None)); }
    let render_ms = t.elapsed().as_secs_f64() * 1000.0;
    let mut steps_json = vec![];
    for si in 0..pres.slides.len() {
        let tl = ShowState::timeline(&pres, si);
        if tl.steps() == 0 { continue }
        let slide = &pres.slides[si];
        let Some(ctx) = Ctx::for_slide(&pres, slide) else { continue };
        let animated = tl.animated_shapes();
        let backdrop = render_slide_part(&pres, si, SlidePart::Backdrop, &opts(SCALE, None));
        // The layers bottom to top, in the shapes' own order: what stands still between animated shapes is a layer of
        // its own; a shape built by paragraph is a layer of the paragraphs that stand still, then one per paragraph.
        let segs = segments(&slide.shapes, &animated, &tl);
        let pictures: Vec<Image> = segs.iter().map(|seg| {
            let visible: &std::collections::HashSet<ShapeId> = &seg.visible;
            let n = seg.paras;
            let state = |id: ShapeId| {
                if !visible.contains(&id) { return to_state(AnimState::hidden(), vec![]) }
                if Some(id) != seg.anim.map(|a| a.0) || n == 0 { return to_state(shown(), vec![]) }
                let targets = tl.paragraph_targets(id);
                let paras = (0..n).map(|p| (p, para(match seg.anim.and_then(|a| a.1) {
                    Some(lp) => if p == lp { shown() } else { AnimState::hidden() },
                    None => if targets.contains(&p) { AnimState::hidden() } else { shown() },
                }))).collect();
                to_state(shown(), paras)
            };
            let scale = if seg.anim.is_some() { SCALE * LAYER } else { SCALE };
            render_slide_part(&pres, si, SlidePart::Content, &opts(scale, Some(&state)))
        }).collect();
        for step in 0..tl.steps() {
            let len = tl.step_duration(step).clamp(0.1, 10.0);
            let frames = (len * 10.0).ceil() as usize;
            let (mut worst, mut sum, mut tint, mut motion) = (0.0f64, 0.0, false, false);
            for f in 0..=frames {
                let tt = len * f as f64 / frames as f64;
                let mut frame = backdrop.clone();
                for (seg, pic) in segs.iter().zip(&pictures) {
                    let Some((id, p)) = seg.anim else {
                        compose(&mut frame, pic, Affine::IDENTITY, Affine::IDENTITY, 1e9, 1e9, None, 1.0);
                        continue;
                    };
                    let (id, p) = (&id, &p);
                    let Some((shape, parent)) = find_in(&ctx, &slide.shapes, *id, Affine::IDENTITY) else { continue };
                    let x = xfrm(&ctx, shape);
                    let sh = tl.state(*id, None, step, tt);
                    let (vis, op, off) = match p {
                        Some(p) => { let ps = tl.state(*id, Some(*p), step, tt); (sh.visible && ps.visible, sh.opacity * ps.opacity, (sh.offset_x + ps.offset_x, sh.offset_y + ps.offset_y)) }
                        None => (sh.visible, sh.opacity, (sh.offset_x, sh.offset_y)),
                    };
                    if !vis || op <= 0.001 { continue }
                    tint |= sh.tint.is_some();
                    motion |= off != (0.0, 0.0) || sh.scale_x != 1.0 || sh.scale_y != 1.0 || sh.rotate != 0.0 || sh.clip.is_some() || op < 0.999;
                    let c = kurbo::Vec2::new(x.w / 2.0, x.h / 2.0);
                    let around = Affine::translate(c) * Affine::rotate(sh.rotate.to_radians()) * Affine::scale_non_uniform(sh.scale_x, sh.scale_y) * Affine::translate(-c);
                    let m = parent * Affine::translate(kurbo::Vec2::new(off.0, off.1)) * x.affine() * around;
                    compose(&mut frame, pic, parent * x.affine(), m, x.w, x.h, sh.clip, op.clamp(0.0, 1.0));
                }
                let whole_state = |id: ShapeId| live(&tl, id, step, tt);
                let whole = render_slide(&pres, si, &opts(SCALE, Some(&whole_state)));
                if whole.pixels.len() != frame.pixels.len() || frame.width == 0 { continue }
                let px = frame.pixels.chunks(4).zip(whole.pixels.chunks(4)).filter(|(x, y)| x.iter().zip(y.iter()).any(|(p, q)| (*p as i32 - *q as i32).abs() > 24)).count();
                let share = 100.0 * px as f64 / (frame.width * frame.height) as f64;
                if share > worst {
                    if let Ok(dir) = std::env::var("DUMP") {
                        std::fs::write(format!("{dir}/s{}-step{step}-layers.png", si + 1), frame.to_png()).ok();
                        std::fs::write(format!("{dir}/s{}-step{step}-whole.png", si + 1), whole.to_png()).ok();
                    }
                }
                worst = worst.max(share);
                sum += share;
            }
            // DeckCraft's whole drawing moves no animated group (its renderer draws a group's children with the
            // group's resting transform), so a step that animates one has no right reference.
            let group = tl.effects().iter().filter(|e| e.step == step).any(|e| matches!(find(&slide.shapes, e.shape).map(|s| &s.kind), Some(ShapeKind::Group { .. })));
            let effects: Vec<String> = tl.effects().iter().filter(|e| e.step == step).filter_map(|e| slide.animations.get(e.anim)).map(|a| esc(&format!("{:?}:{}", a.class, a.effect))).collect();
            steps_json.push(format!("{{\"slide\":{},\"step\":{step},\"effects\":[{}],\"mean\":{:.3},\"worst\":{:.3},\"tint\":{tint},\"motion\":{motion},\"group\":{group}}}", si + 1, effects.join(","), sum / (frames + 1) as f64, worst));
        }
    }
    println!("{{\"file\":{},\"ok\":true,\"slides\":{},\"import_ms\":{import_ms:.1},\"render_ms\":{render_ms:.1},\"steps\":[{}]}}", esc(&name), pres.slides.len(), steps_json.join(","));
}
