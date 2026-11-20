//! states FILE.pptx OUTDIR: every slide after each of its clicks (0 = before the first), 480×270, as DeckCraft draws
//! it: s{slide:02}-c{click}.png, slide and click from 1 and 0. What PowerPoint's own PDF and movie are compared with.
use deckcraft_anim::ShowState;
use deckcraft_geom::Vec2;
use deckcraft_model::ShapeId;
use deckcraft_render::{ParaState, RenderOpts, ShapeState};

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let pres = deckcraft_pptx::import(&std::fs::read(&a[1]).expect("read")).expect("import");
    std::fs::create_dir_all(&a[2]).expect("dir");
    let scale = 480.0 / pres.slide_size.width;
    for si in 0..pres.slides.len() {
        if pres.slides[si].hidden { continue }
        let tl = ShowState::timeline(&pres, si);
        for step in 0..=tl.steps() {
            let state = |id: ShapeId| {
                let s = tl.state(id, None, step, 0.0);
                ShapeState {
                    visible: s.visible, opacity: s.opacity, offset: Vec2::new(s.offset_x, s.offset_y), scale: (s.scale_x, s.scale_y),
                    rotate: s.rotate, clip: s.clip, tint: s.tint,
                    paras: tl.paragraph_targets(id).into_iter().map(|p| {
                        let s = tl.state(id, Some(p), step, 0.0);
                        (p, ParaState { visible: s.visible, opacity: s.opacity, offset: Vec2::new(s.offset_x, s.offset_y) })
                    }).collect(),
                }
            };
            let img = deckcraft_render::render_slide(&pres, si, &RenderOpts { scale, state: Some(&state), threads: 4, ..Default::default() });
            std::fs::write(format!("{}/s{:02}-c{step}.png", a[2], si + 1), img.to_png()).expect("write");
        }
    }
}
