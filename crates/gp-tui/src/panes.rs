// A scrolled list of lines, as every list here draws (the start page, the running order, an item's slides, the phone's
// one column): where it stands is the shell's (docs/view-models.md, "What stays a shell's"). It follows its focus (the
// row selected, the slide made ready or shown) until the wheel or a swipe moves it, and then stays where it was moved
// until the next key or click. Each row it draws is recorded for clicks, and the pane itself for the wheel.
use crate::app::App;
use crate::keys::{Pane, Target};
use crate::ui::Hits;
use ratatui::layout::Rect;
use ratatui::text::Line;
use ratatui::widgets::{Block, Paragraph};
use ratatui::Frame;

/// A list's lines, and where each row (an item, a slide, a start row) begins, how many lines it takes and what it is.
#[derive(Default)]
pub struct Rows {
    pub lines: Vec<Line<'static>>,
    spans: Vec<(u16, u16, Target)>,
    focus: Option<(u16, u16)>,
}

impl Rows {
    /// Lines added at the end: a row a click hits when it has a target, the one kept in sight when it is the focus.
    pub fn push(&mut self, lines: Vec<Line<'static>>, target: Option<Target>, focus: bool) {
        let (start, height) = (self.lines.len() as u16, lines.len() as u16);
        if let Some(target) = target { self.spans.push((start, height, target)) }
        if focus { self.focus = Some((start, height)) }
        self.lines.extend(lines);
    }
}

/// `rows` drawn in `area` inside `block`, scrolled as the app's pane stands.
pub fn draw_rows(f: &mut Frame, area: Rect, block: Block, rows: Rows, pane: Pane, app: &App, hits: &mut Hits) {
    let inner = block.inner(area);
    f.render_widget(block, area);
    hits.push((inner, Target::Pane(pane)));
    let (total, height) = (rows.lines.len() as u16, inner.height);
    let at = &app.offsets[pane as usize];
    let mut offset = at.get();
    if app.follow[pane as usize] { if let Some((start, h)) = rows.focus { offset = follow(offset, start, h, height) } }
    offset = offset.min(total.saturating_sub(height));
    at.set(offset);
    f.render_widget(Paragraph::new(rows.lines).scroll((offset, 0)), inner);
    for (start, h, target) in rows.spans {
        let (top, bottom) = (start.max(offset), (start + h).min(offset + height));
        if top < bottom { hits.push((Rect { x: inner.x, y: inner.y + top - offset, width: inner.width, height: bottom - top }, target)) }
    }
}

/// The offset that keeps a row of `h` lines from `start` in a window `height` lines high, moved as little as it can be;
/// a row higher than the window shows its top.
pub fn follow(offset: u16, start: u16, h: u16, height: u16) -> u16 {
    if start < offset { start } else if start + h > offset + height { (start + h).saturating_sub(height).min(start) } else { offset }
}

/// A text broken into lines at most `width` characters wide, at spaces where it can be; its own line breaks kept.
pub fn wrap(text: &str, width: usize) -> Vec<String> {
    let width = width.max(1);
    let mut out = vec![];
    for line in text.lines() {
        let mut current = String::new();
        for word in line.split(' ') {
            let mut word = word.to_string();
            loop {
                let len = current.chars().count();
                let gap = usize::from(len > 0);
                if len + gap + word.chars().count() <= width {
                    if gap == 1 { current.push(' ') }
                    current.push_str(&word);
                    break;
                }
                if len > 0 { out.push(std::mem::take(&mut current)); continue }
                // A word wider than the line, cut where the line ends.
                let rest: String = word.chars().skip(width).collect();
                out.push(word.chars().take(width).collect());
                word = rest;
            }
        }
        out.push(current);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_row_in_sight_stays_where_it_is() {
        // Arrange, Act
        let offset = follow(5, 8, 2, 10);

        // Assert
        assert_eq!(offset, 5);
    }

    #[test]
    fn a_row_above_the_window_is_brought_to_its_top() {
        // Arrange, Act
        let offset = follow(10, 4, 2, 10);

        // Assert
        assert_eq!(offset, 4);
    }

    #[test]
    fn a_row_below_the_window_is_brought_to_its_bottom() {
        // Arrange, Act
        let offset = follow(0, 12, 3, 10);

        // Assert
        assert_eq!(offset, 5);
    }

    #[test]
    fn a_row_higher_than_the_window_shows_its_top() {
        // Arrange, Act
        let offset = follow(0, 12, 20, 10);

        // Assert
        assert_eq!(offset, 12);
    }

    #[test]
    fn wrapping_breaks_at_spaces() {
        // Arrange, Act
        let lines = wrap("Genom stormens brus håller du mig", 15);

        // Assert
        assert_eq!(lines, ["Genom stormens", "brus håller du", "mig"]);
    }

    #[test]
    fn wrapping_keeps_the_texts_own_line_breaks() {
        // Arrange, Act
        let lines = wrap("Herre\ndu är min tröst", 40);

        // Assert
        assert_eq!(lines, ["Herre", "du är min tröst"]);
    }

    #[test]
    fn a_word_wider_than_the_line_is_cut() {
        // Arrange, Act
        let lines = wrap("Halleluja", 4);

        // Assert
        assert_eq!(lines, ["Hall", "eluj", "a"]);
    }
}
