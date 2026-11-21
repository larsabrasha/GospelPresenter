// slideLayoutView's answer as this shell paints it (crates/gp-core/src/slide_layout.rs, slide_items.rs), the same
// fields apps/mac/Sources/GPMac/SlidePainter.swift decodes, and the CSS colours a theme writes.
use serde::Deserialize;

#[derive(Deserialize, Clone, Debug)]
pub struct Picture {
    pub kind: String,
    pub full: Option<String>,
    pub thumb: Option<String>,
}

#[derive(Deserialize, Clone, Debug)]
pub struct Background {
    pub color: Option<String>,
    pub image: Option<Picture>,
    pub fit: Option<String>,
    pub scrim: Option<f64>,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Paint {
    pub color: Option<String>,
    pub shadow: Option<bool>,
    pub outline: Option<f64>,
    pub outline_color: Option<String>,
}

#[derive(Deserialize, Clone, Copy, Debug)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

/// A glyph run: its face by the core's name, its size, each glyph as [id, x, y] on the stage; `opacity` a verse
/// number's 0.4; `bold` a weight the face lacks, drawn bold here.
#[derive(Deserialize, Clone, Debug)]
pub struct Run {
    pub face: String,
    pub size: f64,
    pub glyphs: Vec<[f64; 3]>,
    pub opacity: Option<f64>,
    pub bold: Option<bool>,
}

/// A laid-out text: a song's or Bible text, its credits, or a page's text; `italic` slanted here.
#[derive(Deserialize, Clone, Debug)]
pub struct Text {
    pub role: String,
    pub weight: f64,
    pub size: f64,
    pub paint: Paint,
    pub clip: Rect,
    pub runs: Vec<Run>,
    pub italic: Option<bool>,
}

/// A page's element or a picture slide's picture, in drawing order.
#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub kind: String,
    #[serde(rename = "box")]
    pub at: Option<Rect>,
    pub color: Option<String>,
    pub full: Option<String>,
    pub thumb: Option<String>,
    pub fit: Option<String>,
    pub fill: Option<String>,
    pub stroke: Option<String>,
    pub stroke_width: Option<f64>,
    pub width: Option<f64>,
    pub radius: Option<f64>,
    pub from: Option<[f64; 2]>,
    pub to: Option<[f64; 2]>,
    /// A page's text (`kind` "text"), laid out as a slide's text is.
    #[serde(flatten)]
    pub text: Option<Box<Text>>,
}

/// A slide laid out: `background` none for no slide (an overlay alone on a clear ground).
#[derive(Deserialize, Clone, Debug)]
pub struct SlideLayout {
    pub background: Option<Background>,
    pub items: Vec<Item>,
    pub texts: Vec<Text>,
    pub overlay: Vec<Item>,
}

/// An sRGB colour with its alpha, each 0–1.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Rgba(pub f64, pub f64, pub f64, pub f64);

pub const WHITE: Rgba = Rgba(1.0, 1.0, 1.0, 1.0);
pub const BLACK: Rgba = Rgba(0.0, 0.0, 0.0, 1.0);

/// The CSS colours a theme writes: `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb(…)` and `rgba(…)`; None for any other, as
/// SlidePainter.swift's CSSColor reads them.
pub fn css_colour(text: &str) -> Option<Rgba> {
    let s = text.trim().to_lowercase();
    if let Some(hex) = s.strip_prefix('#') {
        let hex: String = if hex.len() == 3 { hex.chars().flat_map(|c| [c, c]).collect() } else { hex.to_string() };
        if hex.len() != 6 && hex.len() != 8 { return None }
        let v = u32::from_str_radix(&hex, 16).ok()?;
        let n = if hex.len() == 8 { v } else { v << 8 | 0xff };
        let byte = |shift: u32| f64::from(n >> shift & 0xff) / 255.0;
        return Some(Rgba(byte(24), byte(16), byte(8), byte(0)));
    }
    let inner = s.strip_prefix("rgba").or_else(|| s.strip_prefix("rgb"))?.trim().strip_prefix('(')?.strip_suffix(')')?;
    let parts: Vec<&str> = inner.split([',', ' ', '/']).filter(|p| !p.is_empty()).collect();
    if parts.len() != 3 && parts.len() != 4 { return None }
    let rgb: Vec<f64> = parts[..3].iter().map(|p| p.parse::<f64>().ok().map(|v| v / 255.0)).collect::<Option<_>>()?;
    let alpha = match parts.get(3) {
        Some(a) => match a.strip_suffix('%') { Some(p) => p.parse::<f64>().ok()? / 100.0, None => a.parse().ok()? },
        None => 1.0,
    };
    Some(Rgba(rgb[0], rgb[1], rgb[2], alpha))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_short_hex_colour_reads_as_its_long_form() {
        // Arrange, Act
        let c = css_colour("#fff");

        // Assert
        assert_eq!(c, Some(WHITE));
    }

    #[test]
    fn an_rgba_colour_keeps_its_alpha() {
        // Arrange, Act
        let c = css_colour("rgba(0, 0, 0, 0.5)");

        // Assert
        assert_eq!(c, Some(Rgba(0.0, 0.0, 0.0, 0.5)));
    }

    #[test]
    fn a_named_colour_is_not_read() {
        // Arrange, Act
        let c = css_colour("red");

        // Assert
        assert_eq!(c, None);
    }

    #[test]
    fn a_fill_item_decodes_without_a_text() {
        // Arrange
        let json = r##"{"kind":"fill","color":"#123456","box":{"x":0,"y":0,"w":1920,"h":1080}}"##;

        // Act
        let item: Item = serde_json::from_str(json).unwrap();

        // Assert
        assert!(item.text.is_none());
    }

    #[test]
    fn a_page_text_item_decodes_with_its_text() {
        // Arrange
        let json = r##"{"kind":"text","role":"text","face":"Inter","weight":400,"size":40,"lineHeight":1.2,
            "paint":{"color":"#fff"},"clip":{"x":0,"y":0,"w":1920,"h":1080},"lines":[],"runs":[]}"##;

        // Act
        let item: Item = serde_json::from_str(json).unwrap();

        // Assert
        assert_eq!(item.text.map(|t| t.size), Some(40.0));
    }

    #[test]
    fn a_song_slides_layout_decodes() {
        // Arrange
        let json = r##"{"width":1920,"height":1080,"background":{"color":"#000","image":null,"fit":"cover","scrim":0},
            "items":[],"overlay":[],"texts":[{"role":"main","face":"Inter","weight":600,"size":64,"lineHeight":1.4,
            "paint":{"color":"#fff","shadow":true,"outline":0,"outlineColor":null},"clip":{"x":0,"y":0,"w":1920,"h":1080},
            "lines":[],"runs":[{"face":"Inter","size":64,"glyphs":[[36,100.5,200]]}]}]}"##;

        // Act
        let l: SlideLayout = serde_json::from_str(json).unwrap();

        // Assert
        assert_eq!(l.texts[0].runs[0].glyphs[0], [36.0, 100.5, 200.0]);
    }
}
