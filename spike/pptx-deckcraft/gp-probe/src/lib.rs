//! What Gospel Presenter would take of DeckCraft: a .pptx read, and each slide drawn at each click of its builds.
use deckcraft_anim::{ShowState, Timeline};
use deckcraft_geom::Vec2;
use deckcraft_model::ShapeId;
use deckcraft_render::{ParaState, RenderOpts, ShapeState};

/// A shape's state once `step` clicks are done (DeckCraft's own mapping, `canvas/preview.rs`).
fn shape_state(tl: &Timeline, id: ShapeId, step: usize) -> ShapeState {
    let a = tl.state(id, None, step, 0.0);
    ShapeState {
        visible: a.visible,
        opacity: a.opacity,
        offset: Vec2::new(a.offset_x, a.offset_y),
        scale: (a.scale_x, a.scale_y),
        rotate: a.rotate,
        clip: a.clip,
        tint: a.tint,
        paras: tl
            .paragraph_targets(id)
            .into_iter()
            .map(|p| {
                let a = tl.state(id, Some(p), step, 0.0);
                (p, ParaState { visible: a.visible, opacity: a.opacity, offset: Vec2::new(a.offset_x, a.offset_y) })
            })
            .collect(),
    }
}

/// Every slide at every click, as PNG: (slide, step, steps of the slide, png).
pub fn pictures(pptx: &[u8], scale: f64) -> Result<Vec<(usize, usize, usize, Vec<u8>)>, String> {
    let pres = deckcraft_pptx::import(pptx).map_err(|e| e.to_string())?;
    let mut out = vec![];
    for i in 0..pres.slides.len() {
        let tl = ShowState::timeline(&pres, i);
        let steps = tl.steps();
        for step in 0..=steps {
            let state = |id: ShapeId| shape_state(&tl, id, step);
            let opts = RenderOpts { scale, state: Some(&state), ..Default::default() };
            let img = deckcraft_render::render_slide(&pres, i, &opts);
            out.push((i, step, steps, img.to_png()));
        }
    }
    Ok(out)
}

/// The C door a Swift shell would call: a .pptx in, the number of pictures written into `dir` out (−1 on failure).
///
/// # Safety
/// `data` is `len` readable bytes; `dir` a NUL-terminated path.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn gp_pptx_pictures(data: *const u8, len: usize, dir: *const std::ffi::c_char) -> i32 {
    let bytes = unsafe { std::slice::from_raw_parts(data, len) };
    let dir = unsafe { std::ffi::CStr::from_ptr(dir) }.to_string_lossy().into_owned();
    match pictures(bytes, 2.0) {
        Ok(all) => {
            for (i, step, _, png) in &all {
                if std::fs::write(format!("{dir}/slide-{:02}-click-{step}.png", i + 1), png).is_err() {
                    return -1;
                }
            }
            all.len() as i32
        }
        Err(_) => -1,
    }
}
