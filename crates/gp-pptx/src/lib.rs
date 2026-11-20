//! A PowerPoint deck as a slideshow's pages (docs/powerpoint-deckcraft.md, step 1, Lars 2026-11-20): every slide
//! shown, at every click of its builds, drawn by DeckCraft's libraries to the pictures a PDF's page has (a JPEG
//! fitting 1920×1080 and a thumbnail fitting 400×225, `IMAGE_VARIANTS` in packages/core/src/media.ts), so they sync
//! and show as a PDF's pages do, a hard cut between clicks. Hidden slides are left out, as a show leaves them.
use deckcraft_anim::{ShowState, Timeline};
use deckcraft_geom::Vec2;
use deckcraft_model::{Shape, ShapeId, ShapeKind};
use deckcraft_render::{Image, ParaState, RenderOpts, ShapeState};
use image::codecs::jpeg::JpegEncoder;
use image::imageops::FilterType;
use image::{RgbImage, RgbaImage};

/// `IMAGE_VARIANTS`: the full picture's box and quality, and the thumbnail's.
const FULL: (u32, u32, u8) = (1920, 1080, 90);
const THUMB: (u32, u32, u8) = (400, 225, 80);

/// One page: the slide (from 1, as PowerPoint numbers them) and the click after which it stands (0 before the first).
pub struct Page {
    pub slide: usize,
    pub click: usize,
    pub full: Vec<u8>,
    pub thumb: Vec<u8>,
}

/// The deck's pages, and whether a slide shown has a chart, which DeckCraft draws otherwise than PowerPoint (axis
/// labels, legends): the import then suggests the PDF PowerPoint exports.
pub struct Deck {
    pub pages: Vec<Page>,
    pub charts: bool,
}

/// A shape's state once `click` clicks are done (DeckCraft's own mapping, its `canvas/preview.rs`).
fn shape_state(tl: &Timeline, id: ShapeId, click: usize) -> ShapeState {
    let a = tl.state(id, None, click, 0.0);
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
                let a = tl.state(id, Some(p), click, 0.0);
                (p, ParaState { visible: a.visible, opacity: a.opacity, offset: Vec2::new(a.offset_x, a.offset_y) })
            })
            .collect(),
    }
}

fn has_chart(shapes: &[Shape]) -> bool {
    shapes.iter().any(|s| match &s.kind {
        ShapeKind::Chart(_) => true,
        ShapeKind::Group { children, .. } => has_chart(children),
        _ => false,
    })
}

/// A picture as JPEG, laid on white (a slide is opaque; a transparent edge would be black).
fn jpeg(img: &RgbaImage, quality: u8) -> Vec<u8> {
    let mut rgb = RgbImage::new(img.width(), img.height());
    for (x, y, p) in img.enumerate_pixels() {
        let a = p[3] as u32;
        let on_white = |c: u8| ((c as u32 * a + 255 * (255 - a)) / 255) as u8;
        rgb.put_pixel(x, y, image::Rgb([on_white(p[0]), on_white(p[1]), on_white(p[2])]));
    }
    let mut out = vec![];
    JpegEncoder::new_with_quality(&mut out, quality).encode_image(&rgb).expect("a JPEG of an image in memory");
    out
}

/// The size `w`×`h` fitted within `bw`×`bh`, never larger (`fitWithin` in packages/core).
fn fit(w: u32, h: u32, bw: u32, bh: u32) -> (u32, u32) {
    let s = (bw as f64 / w as f64).min(bh as f64 / h as f64).min(1.0);
    (((w as f64 * s).round() as u32).max(1), ((h as f64 * s).round() as u32).max(1))
}

fn page(img: Image, slide: usize, click: usize) -> Page {
    let rgba = RgbaImage::from_raw(img.width, img.height, img.to_straight()).expect("a picture's pixels fill it");
    let (tw, th) = fit(rgba.width(), rgba.height(), THUMB.0, THUMB.1);
    let thumb = image::imageops::resize(&rgba, tw, th, FilterType::Triangle);
    Page { slide, click, full: jpeg(&rgba, FULL.2), thumb: jpeg(&thumb, THUMB.2) }
}

/// Every slide shown at every click, or why the file cannot be read.
pub fn pages(pptx: &[u8]) -> Result<Deck, String> {
    let pres = deckcraft_pptx::import(pptx).map_err(|e| e.to_string())?;
    // Points to pixels so the slide fits 1920×1080, as a PDF's page is drawn at the size it is shown.
    let (w, h) = (pres.slide_size.width, pres.slide_size.height);
    if !(w > 0.0 && h > 0.0) {
        return Err("the deck has no slide size".into());
    }
    let scale = (FULL.0 as f64 / w).min(FULL.1 as f64 / h);
    let mut deck = Deck { pages: vec![], charts: false };
    for (i, slide) in pres.slides.iter().enumerate().filter(|(_, s)| !s.hidden) {
        deck.charts |= has_chart(&slide.shapes);
        let tl = ShowState::timeline(&pres, i);
        for click in 0..=tl.steps() {
            let state = |id: ShapeId| shape_state(&tl, id, click);
            let opts = RenderOpts { scale, state: Some(&state), ..Default::default() };
            deck.pages.push(page(deckcraft_render::render_slide(&pres, i, &opts), i + 1, click));
        }
    }
    Ok(deck)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_wide_slide_fits_the_box_by_its_width() {
        assert_eq!(fit(1920, 1080, 400, 225), (400, 225));
    }

    #[test]
    fn a_small_picture_is_never_made_larger() {
        assert_eq!(fit(200, 100, 400, 225), (200, 100));
    }

    #[test]
    fn a_four_by_three_slide_fits_by_its_height() {
        assert_eq!(fit(1440, 1080, 1920, 1080), (1440, 1080));
    }

    #[test]
    fn what_is_not_a_deck_is_refused() {
        assert!(pages(b"not a zip").is_err());
    }

    /// fixtures/deck.pptx (make_deck.py): a list of three built a paragraph a click, a hidden slide, a chart.
    const DECK: &[u8] = include_bytes!("../fixtures/deck.pptx");

    #[test]
    fn each_click_of_a_build_is_a_page_and_a_hidden_slide_none() {
        let deck = pages(DECK).unwrap();

        let at: Vec<(usize, usize)> = deck.pages.iter().map(|p| (p.slide, p.click)).collect();
        assert_eq!(at, vec![(1, 0), (1, 1), (1, 2), (1, 3), (3, 0)]);
    }

    #[test]
    fn a_deck_with_a_chart_says_so() {
        assert!(pages(DECK).unwrap().charts);
    }

    #[test]
    fn a_page_is_a_full_picture_and_a_thumbnail_as_a_pdfs_page() {
        let deck = pages(DECK).unwrap();

        let size = |b: &[u8]| { let i = image::load_from_memory(b).unwrap(); (i.width(), i.height()) };
        assert_eq!((size(&deck.pages[0].full), size(&deck.pages[0].thumb)), ((1920, 1080), (400, 225)));
    }
}
