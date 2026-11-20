//! frames DECK.pptx OUTDIR: the first slide's builds played as frames at 30 per second, 1920×1080, timed per frame.
use deckcraft_anim::ShowState;
use deckcraft_geom::Vec2;
use deckcraft_model::ShapeId;
use deckcraft_render::{ParaState, RenderOpts, ShapeState};

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let pres = deckcraft_pptx::import(&std::fs::read(&a[1]).expect("read")).expect("import");
    std::fs::create_dir_all(&a[2]).expect("dir");
    let tl = ShowState::timeline(&pres, 0);
    for threads in [0u16, 4, 8] {
        let mut times = vec![];
        let mut n = 0;
        for step in 0..tl.steps() {
            let len = tl.step_duration(step).max(0.1);
            let frames = (len * 30.0).ceil() as usize;
            for f in 0..=frames {
                let t = len * f as f64 / frames as f64;
                let state = |id: ShapeId| {
                    let s = tl.state(id, None, step, t);
                    ShapeState {
                        visible: s.visible, opacity: s.opacity, offset: Vec2::new(s.offset_x, s.offset_y), scale: (s.scale_x, s.scale_y),
                        rotate: s.rotate, clip: s.clip, tint: s.tint,
                        paras: tl.paragraph_targets(id).into_iter().map(|p| {
                            let s = tl.state(id, Some(p), step, t);
                            (p, ParaState { visible: s.visible, opacity: s.opacity, offset: Vec2::new(s.offset_x, s.offset_y) })
                        }).collect(),
                    }
                };
                let opts = RenderOpts { scale: 2.0, state: Some(&state), threads, ..Default::default() };
                let start = std::time::Instant::now();
                let img = deckcraft_render::render_slide(&pres, 0, &opts);
                times.push(start.elapsed().as_secs_f64() * 1000.0);
                if threads == 0 && (step == 5 || step == 2) {
                    std::fs::write(format!("{}/step{step}-f{f:02}.png", a[2]), img.to_png()).expect("write");
                }
                n += 1;
            }
        }
        times.sort_by(|x, y| x.total_cmp(y));
        println!("threads {threads}: {n} frames, median {:.1} ms, worst {:.1} ms", times[times.len() / 2], times[times.len() - 1]);
    }
}
