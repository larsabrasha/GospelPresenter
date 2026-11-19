// A presentation in one column, on a terminal narrower than `ui::NARROW` (a phone over SSH), as the app's phone layout
// (docs/layout-2-0.md, "Live, one column"; apps/mac/Sources/GPMac/PhoneLayout.swift): while presenting, what is shown at
// the top with Släck at its right; then the whole running order, each item a heading and every slide a row with its
// whole text. A click on a slide shows it while presenting and before it makes it ready (`show`, the core's).
use crate::app::App;
use crate::keys::{Pane, Target};
use crate::panes::{draw_rows, wrap, Rows};
use crate::texts::t;
use crate::ui::{item_lines, shown_text, slide_head, Hits, Marks, LIVE, READY};
use crate::views::*;
use ratatui::layout::{Alignment, Constraint, Layout, Rect};
use ratatui::style::{Style, Stylize};
use ratatui::text::Line;
use ratatui::widgets::{Block, Paragraph, Wrap};
use ratatui::Frame;

/// At most this many lines of the slide shown at the top, so the running order keeps the rest of the screen.
const SHOWN_LINES: u16 = 6;

pub fn page(f: &mut Frame, area: Rect, app: &App, page: &PresentationPage, hits: &mut Hits) {
    let column = if app.is_live() {
        let text = shown_text(app);
        let height = (text.lines.len() as u16).clamp(1, SHOWN_LINES) + 2;
        let [top, column] = Layout::vertical([Constraint::Length(height), Constraint::Min(1)]).areas(area);
        let slack = t("live.clear", &[]);
        let [now, button] = Layout::horizontal([Constraint::Min(1), Constraint::Length(slack.chars().count() as u16 + 4)]).areas(top);
        let title = Line::from(format!(" {} ", t("live.shownBadge", &[]))).fg(LIVE).bold();
        f.render_widget(Paragraph::new(text).wrap(Wrap { trim: false }).block(Block::bordered().border_style(Style::new().fg(LIVE)).title(title)), now);
        // Släck, lit while the outputs are black.
        let label = Line::from(slack).alignment(Alignment::Center);
        f.render_widget(Paragraph::new(if app.live.black { label.reversed() } else { label }).block(Block::bordered()), button);
        hits.push((button, Target::Black));
        column
    } else { area };
    draw_rows(f, column, Block::new(), rows(app, page, column.width), Pane::Column, app, hits);
}

/// The whole running order, every slide with its whole text broken to `width`; kept in sight: the slide made ready,
/// else the one shown, else the item selected.
fn rows(app: &App, page: &PresentationPage, width: u16) -> Rows {
    let picked = app.state.picked.is_some();
    let shown = app.is_live() && app.marks.shown.is_some();
    let mut rows = Rows::default();
    for item in &page.items {
        let selected = app.state.selected_id.as_deref() == Some(item.id.as_str());
        rows.push(item_lines(app, page, item, selected), Some(Target::Item(item.id.clone())), selected && !picked && !shown);
        for (n, slide) in page.slides_of(&item.id).iter().enumerate() {
            let at = SlideAt { item_id: item.id.clone(), part_index: n as i64 };
            let marks = Marks::of(app, &at);
            let text = if slide.text.trim().is_empty() { format!("▣ {}", item.title) } else { slide.text.clone() };
            let body = wrap(&text, width.saturating_sub(5) as usize).into_iter().map(|l| Line::from(format!("    {l}")));
            let mut lines = vec![slide_head(n, slide, &marks)];
            lines.extend(body);
            if marks.picked { lines = lines.into_iter().map(|l| l.fg(READY)).collect() }
            let focus = marks.picked || (!picked && marks.shown);
            rows.push(lines, Some(Target::Slide(at)), focus);
        }
    }
    rows
}
