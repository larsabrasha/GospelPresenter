// The start page: the core's lists (`startPageView`), each row in columns, the same widths through every list, so the
// names, dates, times, places and numbers of items stand under each other: a mark (● while presented), the name, the
// date, the time, the place, and the number of items at the right. A day of one digit is padded, so the months line
// up too. Where the columns do not fit (a phone over SSH), each row takes two lines: its name, and the rest under it.
use crate::app::App;
use crate::dates::part;
use crate::keys::{Pane, Target};
use crate::panes::{draw_rows, Rows};
use crate::texts::{t, t_of};
use crate::ui::{Hits, LIVE};
use ratatui::layout::{Margin, Rect};
use ratatui::style::Stylize;
use ratatui::text::{Line, Span};
use ratatui::widgets::Block;
use ratatui::Frame;

/// The space between two columns.
const GAP: &str = "   ";

/// A row's cells: its name, date, time, place and number of items.
struct Cells { live: bool, name: String, date: String, time: String, place: String, items: String }

pub fn page(f: &mut Frame, area: Rect, app: &App, hits: &mut Hits) {
    let lists: Vec<(String, Vec<Cells>)> = app.lists.iter().map(|list| {
        let cells = list.rows.iter().map(|row| {
            let [date, time, place] = ["date", "time", "place"].map(|of| part(&row.line, of));
            let count = row.item_count;
            let items = if count == 1 { t("presentations.item", &[]) } else { t("presentations.items", &[("n", &count.to_string())]) };
            Cells { live: app.live.presentation_id.as_deref() == Some(row.id.as_str()), name: row.name.clone(), date, time, place, items }
        }).collect();
        (t_of(&list.title.clone().into()), cells)
    }).collect();
    let all: Vec<&Cells> = lists.iter().flat_map(|(_, c)| c).collect();
    let width = |cell: fn(&Cells) -> String| all.iter().map(|c| cell(c).chars().count()).max().unwrap_or(0);
    let widths = [width(|c| c.name.clone()), width(|c| pad_day(&c.date)), width(|c| c.time.clone()), width(|c| c.place.clone()), width(|c| c.items.clone())];
    let inner = area.inner(Margin::new(1, 0));
    let fits = 2 + widths.iter().sum::<usize>() + GAP.len() * 4 <= inner.width as usize;
    let mut rows = Rows::default();
    rows.push(vec![Line::from(t("nav.presentations", &[]).bold()), Line::default()], None, false);
    if lists.is_empty() { rows.push(vec![Line::from(t("presentations.emptyTitle", &[]).dim())], None, false) }
    let mut n = 0;
    for (title, cells) in &lists {
        rows.push(vec![Line::from(title.clone().bold().underlined())], None, false);
        for c in cells {
            let lines = if fits { vec![columns(c, &widths)] } else { two_lines(c) };
            let on = n == app.cursor;
            rows.push(if on { lines.into_iter().map(|l| l.reversed()).collect() } else { lines }, Some(Target::Row(n)), on);
            n += 1;
        }
        rows.push(vec![Line::default()], None, false);
    }
    draw_rows(f, inner, Block::new(), rows, Pane::Start, app, hits);
}

fn mark(c: &Cells) -> Span<'static> { if c.live { Span::raw("● ").fg(LIVE) } else { Span::raw("  ") } }

/// `text` padded with spaces to `width` characters, at its right or (`right`) its left.
fn pad(text: &str, width: usize, right: bool) -> String {
    let fill = " ".repeat(width.saturating_sub(text.chars().count()));
    if right { format!("{fill}{text}") } else { format!("{text}{fill}") }
}

/// One line, each cell at its column; the number of items at the right of its column, so the numbers line up.
fn columns(c: &Cells, w: &[usize; 5]) -> Line<'static> {
    let rest = [pad(&pad_day(&c.date), w[1], false), pad(&c.time, w[2], false), pad(&c.place, w[3], false), pad(&c.items, w[4], true)].join(GAP);
    Line::from(vec![mark(c), Span::raw(pad(&c.name, w[0], false)), Span::raw(format!("{GAP}{rest}")).dim()])
}

/// Two lines, where the columns do not fit: the name, and under it the rest as the Mac app's second line has it.
fn two_lines(c: &Cells) -> Vec<Line<'static>> {
    let rest = [c.date.as_str(), &c.time, &c.place, &c.items].into_iter().filter(|s| !s.is_empty()).collect::<Vec<_>>().join(" · ");
    vec![Line::from(vec![mark(c), Span::raw(c.name.clone())]), Line::from(format!("  {rest}")).dim()]
}

/// "sön 8 november" as "sön  8 november", so a day of one digit stands under the ones of two.
fn pad_day(date: &str) -> String {
    match date.split_once(' ') {
        Some((day, rest)) if rest.split(' ').next().is_some_and(|d| d.len() == 1 && d.chars().all(|c| c.is_ascii_digit())) => format!("{day}  {rest}"),
        _ => date.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_day_of_one_digit_is_padded() {
        // Arrange, Act
        let date = pad_day("sön 8 november 2026");

        // Assert
        assert_eq!(date, "sön  8 november 2026");
    }

    #[test]
    fn a_day_of_two_digits_is_kept() {
        // Arrange, Act
        let date = pad_day("sön 25 oktober 2026");

        // Assert
        assert_eq!(date, "sön 25 oktober 2026");
    }

    #[test]
    fn idag_is_kept() {
        // Arrange, Act
        let date = pad_day("Idag");

        // Assert
        assert_eq!(date, "Idag");
    }

    #[test]
    fn a_number_is_padded_at_its_left() {
        // Arrange, Act
        let text = pad("7 inslag", 9, true);

        // Assert
        assert_eq!(text, " 7 inslag");
    }
}
