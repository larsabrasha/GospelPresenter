// A song slide's main text laid out and fitted as the web's FittedText does it (apps/web/src/ui/FittedText.tsx), with
// parley: the theme's size, made smaller by halving between 35 % and 100 % eight times while the text is taller than
// its box, then the size rounded down. Reads {fonts, style, slides} as JSON on stdin; writes, for each slide, the
// fitted size, the number of lines and where each line that has text starts (UTF-16 offsets, as the browser counts).
use parley::{
    FontContext, FontFamily, FontWeight, Layout, LayoutContext, LineHeight, OverflowWrap, StyleProperty,
};
use serde::{Deserialize, Serialize};
use std::io::Read;

#[derive(Deserialize)]
struct Style {
    family: String,
    weight: f32,
    size: f32,
    #[serde(rename = "lineHeight")]
    line_height: f32,
    width: f32,
    height: f32,
}

#[derive(Deserialize)]
struct Input {
    fonts: Vec<String>,
    style: Style,
    slides: Vec<String>,
}

#[derive(Serialize)]
struct Answer {
    size: f32,
    lines: usize,
    starts: Vec<usize>,
    widths: Vec<f32>,
}

const MIN_SCALE: f32 = 0.35;

struct Fitter {
    fonts: FontContext,
    layouts: LayoutContext<()>,
}

impl Fitter {
    fn layout(&mut self, text: &str, style: &Style, size: f32) -> Layout<()> {
        let mut b = self.layouts.ranged_builder(&mut self.fonts, text, 1.0, true);
        b.push_default(StyleProperty::FontFamily(FontFamily::named(&style.family)));
        b.push_default(StyleProperty::FontWeight(FontWeight::new(style.weight)));
        b.push_default(StyleProperty::FontSize(size));
        b.push_default(StyleProperty::LineHeight(LineHeight::FontSizeRelative(style.line_height)));
        b.push_default(StyleProperty::OverflowWrap(OverflowWrap::BreakWord));
        let mut layout = b.build(text);
        layout.break_all_lines(Some(style.width));
        layout
    }

    /// FittedText's `fits`: the text's height, as offsetHeight rounds it, at most the box's and a pixel.
    fn fits(&mut self, text: &str, style: &Style, size: f32) -> bool {
        self.layout(text, style, size).height().round() <= style.height + 1.0
    }

    fn fit(&mut self, text: &str, style: &Style) -> Answer {
        let base = style.size;
        let size = if self.fits(text, style, base) {
            base
        } else {
            let (mut lo, mut hi) = (MIN_SCALE, 1.0f32);
            for _ in 0..8 {
                let mid = (lo + hi) / 2.0;
                if self.fits(text, style, base * mid) { lo = mid } else { hi = mid }
            }
            (base * lo).floor()
        };
        let layout = self.layout(text, style, size);
        let utf16 = |byte: usize| text[..byte].encode_utf16().count();
        let starts = layout
            .lines()
            .filter_map(|line| {
                let range = line.text_range();
                let first = text[range.clone()].char_indices().find(|(_, c)| !c.is_whitespace())?.0;
                Some(utf16(range.start + first))
            })
            .collect();
        // Each line's width without the white space that hangs past its end: how near the box's edge a break was.
        let widths = layout.lines().map(|line| line.metrics().advance - line.metrics().hanging_advance).collect();
        Answer { size, lines: layout.lines().count(), starts, widths }
    }
}

fn main() {
    let mut raw = String::new();
    std::io::stdin().read_to_string(&mut raw).unwrap();
    let input: Input = serde_json::from_str(&raw).unwrap();
    let mut fitter = Fitter { fonts: FontContext::new(), layouts: LayoutContext::new() };
    for path in &input.fonts {
        let bytes = std::fs::read(path).unwrap();
        // Named as the theme names it, as @font-face does: a variable file's own name is its default instance's
        // (Montserrat's "Montserrat Thin"), which a theme's "Montserrat" would not find.
        let named = parley::fontique::FontInfoOverride { family_name: Some(&input.style.family), ..Default::default() };
        fitter.fonts.collection.register_fonts(bytes.into(), Some(named));
    }
    let started = std::time::Instant::now();
    let answers: Vec<Answer> = input.slides.iter().map(|text| fitter.fit(text, &input.style)).collect();
    let ms = started.elapsed().as_secs_f64() * 1000.0;
    eprintln!("parley: {} slides in {ms:.0} ms, {:.3} ms a slide", answers.len(), ms / answers.len().max(1) as f64);
    println!("{}", serde_json::to_string(&answers).unwrap());
}
