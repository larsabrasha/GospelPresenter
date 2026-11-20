//! layers DECK.pptx OUTDIR: the first slide's builds as layers drawn once (the backdrop, what stands still, each
//! animated shape or paragraph alone), each frame put together from them by moving and fading them, as a GPU would;
//! every frame compared with the slide drawn whole at the same moment.
use deckcraft_anim::{AnimState, ShowState, Timeline};
use deckcraft_geom::Vec2;
use deckcraft_model::ShapeId;
use deckcraft_render::{render_slide, render_slide_part, Image, ParaState, RenderOpts, ShapeState, SlidePart};
use std::time::Instant;

const SCALE: f64 = 2.0;

fn to_state(s: AnimState, paras: Vec<(usize, ParaState)>) -> ShapeState {
    ShapeState { visible: s.visible, opacity: s.opacity, offset: Vec2::new(s.offset_x, s.offset_y), scale: (s.scale_x, s.scale_y), rotate: s.rotate, clip: s.clip, tint: s.tint, paras }
}

fn para(s: AnimState) -> ParaState { ParaState { visible: s.visible, opacity: s.opacity, offset: Vec2::new(s.offset_x, s.offset_y) } }

/// Every shape as the show has it at (step, t).
fn live(tl: &Timeline, id: ShapeId, step: usize, t: f64) -> ShapeState {
    to_state(tl.state(id, None, step, t), tl.paragraph_targets(id).into_iter().map(|p| (p, para(tl.state(id, Some(p), step, t)))).collect())
}

fn shown() -> AnimState { AnimState { visible: true, opacity: 1.0, ..AnimState::hidden() } }

/// A layer: one animated shape, or one paragraph of one.
#[derive(Clone, Copy)]
struct Layer { id: ShapeId, para: Option<usize> }

/// `over` laid on `under` (premultiplied RGBA), faded by `opacity` and moved by (dx, dy) pixels.
fn blend(under: &mut Image, over: &Image, opacity: f64, dx: i64, dy: i64) {
    let (w, h) = (under.width as i64, under.height as i64);
    let o = opacity.clamp(0.0, 1.0);
    for y in 0..h {
        let sy = y - dy;
        if sy < 0 || sy >= h { continue }
        for x in 0..w {
            let sx = x - dx;
            if sx < 0 || sx >= w { continue }
            let s = ((sy * w + sx) * 4) as usize;
            let d = ((y * w + x) * 4) as usize;
            let a = over.pixels[s + 3] as f64 * o / 255.0;
            if a == 0.0 { continue }
            for c in 0..4 {
                under.pixels[d + c] = (over.pixels[s + c] as f64 * o + under.pixels[d + c] as f64 * (1.0 - a)).round().min(255.0) as u8;
            }
        }
    }
}

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let pres = deckcraft_pptx::import(&std::fs::read(&a[1]).expect("read")).expect("import");
    std::fs::create_dir_all(&a[2]).expect("dir");
    let tl = ShowState::timeline(&pres, 0);
    let animated = tl.animated_shapes();
    let mut layers = vec![];
    for &id in &animated {
        let ps = tl.paragraph_targets(id);
        if ps.is_empty() { layers.push(Layer { id, para: None }) } else { layers.extend(ps.into_iter().map(|p| Layer { id, para: Some(p) })) }
    }

    // Drawn once: the backdrop, what stands still, and each layer alone at rest.
    let t0 = Instant::now();
    fn opts<'a>(state: Option<&'a dyn Fn(ShapeId) -> ShapeState>) -> RenderOpts<'a> { RenderOpts { scale: SCALE, state, threads: 8, ..Default::default() } }
    let backdrop = render_slide_part(&pres, 0, SlidePart::Backdrop, &opts(None));
    let still_state = |id: ShapeId| if animated.contains(&id) { to_state(AnimState::hidden(), vec![]) } else { to_state(shown(), vec![]) };
    let still = render_slide_part(&pres, 0, SlidePart::Content, &opts(Some(&still_state)));
    let pictures: Vec<Image> = layers
        .iter()
        .map(|l| {
            let only = |id: ShapeId| {
                if id != l.id { return to_state(AnimState::hidden(), vec![]) }
                let paras = tl.paragraph_targets(id).into_iter().map(|p| (p, para(if Some(p) == l.para { shown() } else { AnimState::hidden() }))).collect();
                to_state(shown(), paras)
            };
            render_slide_part(&pres, 0, SlidePart::Content, &opts(Some(&only)))
        })
        .collect();
    let prepare = t0.elapsed().as_secs_f64() * 1000.0;
    println!("{} layers + backdrop + still drawn once in {prepare:.0} ms", layers.len());

    let (mut worst, mut sum, mut n, mut compose_ms, mut whole_ms, mut moved) = (0.0f64, 0.0, 0, 0.0, 0.0, false);
    for step in 0..tl.steps() {
        let len = tl.step_duration(step).max(0.1);
        let frames = (len * 30.0).ceil() as usize;
        for f in 0..=frames {
            let t = len * f as f64 / frames as f64;
            let s = Instant::now();
            let mut frame = backdrop.clone();
            blend(&mut frame, &still, 1.0, 0, 0);
            for (l, pic) in layers.iter().zip(&pictures) {
                let sh = tl.state(l.id, None, step, t);
                let st = match l.para { Some(p) => { let ps = tl.state(l.id, Some(p), step, t); AnimState { visible: sh.visible && ps.visible, opacity: sh.opacity * ps.opacity, offset_x: sh.offset_x + ps.offset_x, offset_y: sh.offset_y + ps.offset_y, ..sh } } None => sh };
                if !st.visible { continue }
                moved |= st.scale_x != 1.0 || st.scale_y != 1.0 || st.rotate != 0.0 || st.clip.is_some();
                blend(&mut frame, pic, st.opacity, (st.offset_x * SCALE).round() as i64, (st.offset_y * SCALE).round() as i64);
            }
            compose_ms += s.elapsed().as_secs_f64() * 1000.0;
            let s = Instant::now();
            let whole_state = |id: ShapeId| live(&tl, id, step, t);
            let whole = render_slide(&pres, 0, &opts(Some(&whole_state)));
            whole_ms += s.elapsed().as_secs_f64() * 1000.0;
            let px = frame.pixels.chunks(4).zip(whole.pixels.chunks(4)).filter(|(x, y)| x.iter().zip(y.iter()).any(|(p, q)| (*p as i32 - *q as i32).abs() > 16)).count();
            let share = 100.0 * px as f64 / (frame.width * frame.height) as f64;
            worst = worst.max(share);
            sum += share;
            n += 1;
            if step == 5 && f == frames / 2 {
                std::fs::write(format!("{}/layers-mid.png", a[2]), frame.to_png()).expect("w");
                std::fs::write(format!("{}/whole-mid.png", a[2]), whole.to_png()).expect("w");
            }
        }
    }
    println!("{n} frames: pixels apart from the whole drawing, mean {:.3} %, worst {worst:.3} %", sum / n as f64);
    println!("per frame: put together {:.1} ms (on the CPU here; a GPU's job), drawn whole {:.1} ms", compose_ms / n as f64, whole_ms / n as f64);
    println!("scale, rotation or clip used: {moved} (not composed here)");
}
