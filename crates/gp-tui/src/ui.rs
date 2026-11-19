// What the terminal draws from the core's answers (App holds them): the start page, a presentation's page (the running
// order, the selected item's slides with the marks VISAS and NÄSTA and the slide made ready, and a preview), and the
// output view. Layout, colours and glyphs are this shell's; which rows, marks and texts there are is the core's.
// Drawing also says where each row, item and slide landed (`Hits`), so a click finds what it hit.
use crate::app::{App, Screen};
use crate::dates::subtitle;
use crate::keys::Target;
use crate::texts::{t, t_of};
use crate::views::*;
use ratatui::layout::{Alignment, Constraint, Layout, Margin, Rect};
use ratatui::style::{Color, Modifier, Style, Stylize};
use ratatui::text::{Line, Span, Text};
use ratatui::widgets::{Block, Borders, Clear, List, ListItem, ListState, Paragraph, Wrap};
use ratatui::Frame;

/// The live colour, VISAS's, and the blue of the slide made ready, as the web marks them.
const LIVE: Color = Color::Red;
const READY: Color = Color::Blue;

/// Where each thing a click can hit was drawn, the last drawn last.
pub type Hits = Vec<(Rect, Target)>;

/// What a click at a cell hits: the last thing drawn there, so the question to end, drawn over all, hides the rest.
pub fn target_at(hits: &Hits, x: u16, y: u16) -> Option<&Target> {
    hits.iter().rev().find(|(r, _)| x >= r.x && x < r.right() && y >= r.y && y < r.bottom()).map(|(_, t)| t)
}

pub fn draw(f: &mut Frame, app: &App) -> Hits {
    let mut hits = Hits::new();
    let [body, foot] = Layout::vertical([Constraint::Min(1), Constraint::Length(1)]).areas(f.area());
    match app.screen {
        Screen::Start => start(f, body, app, &mut hits),
        Screen::Page => page(f, body, app, &mut hits),
        Screen::Output => output(f, f.area(), app),
    }
    if app.screen != Screen::Output { footer(f, foot, app) }
    // The question to end takes every click; a click outside it is not an answer.
    if app.ending { hits.clear() }
    if app.ending { ask_end(f, f.area()) }
    hits
}

/// The rows of a list as drawn inside `inner`, scrolled by `offset`: each its height and what it is.
fn list_hits(hits: &mut Hits, inner: Rect, offset: usize, rows: impl Iterator<Item = (u16, Target)>) {
    let mut y = inner.y;
    for (height, target) in rows.skip(offset) {
        if y >= inner.bottom() { break }
        hits.push((Rect { x: inner.x, y, width: inner.width, height: height.min(inner.bottom() - y) }, target));
        y += height;
    }
}

fn start(f: &mut Frame, area: Rect, app: &App, hits: &mut Hits) {
    let mut lines = vec![Line::from(t("nav.presentations", &[]).bold()), Line::default()];
    if app.lists.is_empty() { lines.push(Line::from(t("presentations.emptyTitle", &[]).dim())) }
    let mut n = 0;
    let mut at = 0;
    // Each row's line, for its place on the screen.
    let mut row_lines = vec![];
    for list in &app.lists {
        lines.push(Line::from(t_of(&list.title.clone().into()).bold().underlined()));
        for row in &list.rows {
            let mut name = vec![Span::raw(row.name.clone())];
            if app.live.presentation_id.as_deref() == Some(row.id.as_str()) { name.push(Span::raw(format!("  ● {}", t("presentations.live", &[]))).fg(LIVE)) }
            let count = row.item_count.unwrap_or(0);
            let items = if count == 1 { t("presentations.item", &[]) } else { t("presentations.items", &[("n", &count.to_string())]) };
            let sub = subtitle(row, &app.today, list.show_date, list.with_year);
            name.push(Span::raw(format!("   {}", [sub, items].into_iter().filter(|s| !s.is_empty()).collect::<Vec<_>>().join(" · "))).dim());
            let line = Line::from(name);
            row_lines.push(lines.len() as u16);
            if n == app.cursor { at = lines.len(); lines.push(line.reversed()) } else { lines.push(line) }
            n += 1;
        }
        lines.push(Line::default());
    }
    // The cursor's row kept on the screen.
    let scroll = (at as u16).saturating_sub(area.height.saturating_sub(3));
    let inner = area.inner(Margin::new(1, 0));
    f.render_widget(Paragraph::new(lines).scroll((scroll, 0)).block(Block::new().borders(Borders::NONE)), inner);
    for (n, line) in row_lines.into_iter().enumerate() {
        if line < scroll || line - scroll >= inner.height { continue }
        hits.push((Rect { x: inner.x, y: inner.y + line - scroll, width: inner.width, height: 1 }, Target::Row(n)));
    }
}

/// The item whose slides are drawn: the selected one, else the first.
pub fn shown_item(page: &PresentationPage, state: &PageState) -> Option<String> {
    state.selected_id.clone().filter(|s| page.item(s).is_some()).or_else(|| page.items.first().map(|i| i.id.clone()))
}

fn page(f: &mut Frame, area: Rect, app: &App, hits: &mut Hits) {
    let Some(page) = &app.page else {
        f.render_widget(Paragraph::new(t("presentation.notFound", &[])), area);
        return;
    };
    let [head, body] = Layout::vertical([Constraint::Length(2), Constraint::Min(1)]).areas(area);
    header(f, head, app, page);
    let [order, slides, preview] = Layout::horizontal([Constraint::Percentage(30), Constraint::Percentage(36), Constraint::Percentage(34)]).areas(body);
    running_order(f, order, app, page, hits);
    item_slides(f, slides, app, page, hits);
    if app.is_live() { live_preview(f, preview, app) } else { ready_preview(f, preview, app, page) }
}

fn header(f: &mut Frame, area: Rect, app: &App, page: &PresentationPage) {
    let p = page.presentation.as_ref();
    let mut spans = vec![Span::raw(p.map_or(String::new(), |p| p.name.clone())).bold()];
    if let Some(p) = p {
        let sub = subtitle(p, &app.today, true, false);
        if !sub.is_empty() { spans.push(Span::raw(format!("  {sub}")).dim()) }
    }
    if app.is_live() { spans.push(Span::raw(format!("  {} ", t("live.badge", &[]))).fg(Color::White).bg(LIVE).bold()) }
    let cue = app.cue.as_ref().map(|c| {
        let item = page.item(&c.item_id).map_or(String::new(), |i| i.title.clone());
        Line::from(t(&c.text, &[("n", &c.n.to_string()), ("item", &item)]).fg(READY)).alignment(Alignment::Right)
    });
    f.render_widget(Paragraph::new(vec![Line::from(spans), cue.unwrap_or_default()]), area.inner(Margin::new(1, 0)));
}

fn running_order(f: &mut Frame, area: Rect, app: &App, page: &PresentationPage, hits: &mut Hits) {
    let selected = shown_item(page, &app.state);
    let live_item = app.is_live().then(|| app.live.item_id.clone()).flatten();
    let items: Vec<ListItem> = page.items.iter().map(|i| {
        let mark = if live_item.as_deref() == Some(i.id.as_str()) { Span::raw("● ").fg(LIVE) } else { Span::raw("  ") };
        let title = if i.kind.as_deref() == Some("header") { Span::raw(i.title.clone()).bold() } else { Span::raw(i.title.clone()) };
        let mut lines = vec![Line::from(vec![mark, title])];
        if let Some(problem) = page.problem_of(&i.id) { lines.push(Line::from(format!("  {}", t(&problem_key(problem), &[]))).dim()) }
        ListItem::new(lines)
    }).collect();
    let mut state = ListState::default().with_selected(selected.and_then(|s| page.items.iter().position(|i| i.id == s)));
    let list = List::new(items).highlight_style(Style::new().add_modifier(Modifier::REVERSED)).block(Block::bordered());
    f.render_stateful_widget(list, area, &mut state);
    let rows = page.items.iter().map(|i| (1 + page.problem_of(&i.id).is_some() as u16, Target::Item(i.id.clone())));
    list_hits(hits, area.inner(Margin::new(1, 1)), state.offset(), rows);
}

/// A slide's text in short, its first line, or what a picture or a video is: its item's title.
fn first_line(item: &PageItem, slide: &Slide) -> String {
    match slide.text.lines().find(|l| !l.trim().is_empty()) {
        Some(line) => line.to_string(),
        None => format!("▣ {}", item.title),
    }
}

fn item_slides(f: &mut Frame, area: Rect, app: &App, page: &PresentationPage, hits: &mut Hits) {
    let Some(item) = shown_item(page, &app.state).and_then(|id| page.item(&id).cloned()) else {
        f.render_widget(Block::bordered(), area);
        return;
    };
    let live = app.is_live();
    let shown = if live { app.marks.shown.as_ref().and_then(MarkAt::at) } else { None };
    let next = if live { app.marks.next.as_ref().and_then(MarkAt::at) } else { None };
    let mut focus = None;
    let items: Vec<ListItem> = page.slides_of(&item.id).iter().enumerate().map(|(n, s)| {
        let at = SlideAt { item_id: item.id.clone(), part_index: n as i64 };
        let picked = app.state.picked.as_ref() == Some(&at);
        let mut head = vec![Span::raw(format!("{:>2} ", n + 1)).dim()];
        if let Some(label) = &s.label { head.push(Span::raw(label.text.clone()).fg(hex(&label.color)).bold()) }
        if shown.as_ref() == Some(&at) { head.push(Span::raw(format!(" {} ", t("live.shownBadge", &[]))).fg(Color::White).bg(LIVE).bold()) }
        if next.as_ref() == Some(&at) { head.push(Span::raw(format!(" {}", t("live.nextBadge", &[]))).dim().bold()) }
        if picked || shown.as_ref() == Some(&at) { focus = Some(n) }
        let body = Line::from(format!("   {}", first_line(&item, s)));
        let lines = if picked { vec![Line::from(head).fg(READY), body.fg(READY)] } else { vec![Line::from(head), body] };
        ListItem::new(lines)
    }).collect();
    let title = Line::from(format!(" {} ", item.title)).bold();
    let mut state = ListState::default().with_selected(focus);
    let list = List::new(items).block(Block::bordered().title(title)).highlight_symbol("▌").highlight_style(Style::new());
    f.render_stateful_widget(list, area, &mut state);
    let count = page.slides_of(&item.id).len();
    let rows = (0..count).map(|n| (2, Target::Slide(SlideAt { item_id: item.id.clone(), part_index: n as i64 })));
    list_hits(hits, area.inner(Margin::new(1, 1)), state.offset(), rows);
}

/// A slide's whole text, or what it is when it has none.
fn slide_text(item: &PageItem, slide: &Slide) -> Text<'static> {
    if slide.text.trim().is_empty() { return Text::from(format!("▣ {}", item.title)).dim() }
    Text::from(slide.text.lines().map(|l| Line::from(l.to_string())).collect::<Vec<_>>())
}

fn ready_preview(f: &mut Frame, area: Rect, app: &App, page: &PresentationPage) {
    let at = app.state.picked.clone().or_else(|| shown_item(page, &app.state).map(|item_id| SlideAt { item_id, part_index: 0 }));
    let text = at.as_ref().and_then(|at| Some((page.item(&at.item_id)?, page.slide(at)?))).map(|(i, s)| slide_text(i, s)).unwrap_or_default();
    f.render_widget(Paragraph::new(text).wrap(Wrap { trim: false }).block(Block::bordered()), area);
}

fn live_preview(f: &mut Frame, area: Rect, app: &App) {
    let [now, next] = Layout::vertical([Constraint::Percentage(60), Constraint::Percentage(40)]).areas(area);
    let shown_title = Line::from(format!(" {} ", t("live.shownBadge", &[]))).fg(LIVE).bold();
    let shown = match app.shown_slide() {
        Some((item, slide)) => slide_text(item, slide),
        None if app.live.black => Text::from(t("live.clear", &[])).dim(),
        None => Text::default(),
    };
    f.render_widget(Paragraph::new(shown).wrap(Wrap { trim: false }).block(Block::bordered().border_style(Style::new().fg(LIVE)).title(shown_title)), now);
    let next_title = Line::from(format!(" {} ", t("live.nextBadge", &[]))).bold();
    let upcoming = app.next_slide().map(|(i, s)| slide_text(i, s)).unwrap_or_default();
    f.render_widget(Paragraph::new(upcoming).wrap(Wrap { trim: false }).dim().block(Block::bordered().title(next_title)), next);
}

/// The output view: the slide shown, centred, as large as a terminal has; nothing before the first slide and after
/// Släck. One quiet line under it says where presenting stands.
fn output(f: &mut Frame, area: Rect, app: &App) {
    f.render_widget(Clear, area);
    let [stage, status] = Layout::vertical([Constraint::Min(1), Constraint::Length(1)]).areas(area);
    let text = app.shown_slide().map(|(i, s)| slide_text(i, s)).unwrap_or_default();
    let height = text.lines.len() as u16;
    let [_, middle, _] = Layout::vertical([Constraint::Fill(1), Constraint::Length(height), Constraint::Fill(1)]).areas(stage);
    f.render_widget(Paragraph::new(text).bold().alignment(Alignment::Center).wrap(Wrap { trim: true }), middle);
    let line = if app.live.presentation_id.is_none() { String::new() }
        else if app.live.black { t("live.clear", &[]) }
        else { app.shown_slide().map_or(String::new(), |(i, _)| format!("{} · {}", i.title, app.live.part_index + 1)) };
    f.render_widget(Paragraph::new(line).dim().alignment(Alignment::Right), status);
}

/// The keys the screen takes, said with the app's own texts.
fn footer(f: &mut Frame, area: Rect, app: &App) {
    let hint = |key: &str, text: &str| vec![Span::raw(format!(" {key} ")).reversed(), Span::raw(format!(" {}  ", t(text, &[])))];
    let mut spans: Vec<Span> = match app.screen {
        Screen::Start => [hint("↑↓", "shortcuts.moveThroughList"), hint("↵", "shortcuts.openPresentation"), hint("q", "common.close")].concat(),
        // The short ones first: a narrow terminal cuts the line at its end.
        _ if app.is_live() => [hint("Space", "shortcuts.nextSlide"), hint("b", "shortcuts.black"), hint("o", "live.outputWindow"),
            hint("e", "shortcuts.end"), hint("↵", "shortcuts.showMarked"), hint("←→", "shortcuts.moveOutline")].concat(),
        _ => [hint("F5", "shortcuts.start"), hint("Esc", "common.back"), hint("q", "common.close"), hint("⇧↑↓", "shortcuts.nextItem"),
            hint("←→", "shortcuts.moveOutline")].concat(),
    };
    if let Some(code) = &app.refusal { spans.insert(0, Span::raw(format!("{}  ", refusal_text(code))).fg(LIVE)) }
    f.render_widget(Paragraph::new(Line::from(spans)), area);
}

/// Avsluta presentation, asked first as the Mac app asks.
fn ask_end(f: &mut Frame, area: Rect) {
    let width = 60.min(area.width);
    let box_ = Rect { x: area.x + (area.width - width) / 2, y: area.y + area.height / 3, width, height: 6.min(area.height) };
    let text = vec![Line::from(t("live.endText", &[])), Line::default(), Line::from(format!("↵ {}   Esc {}", t("live.end", &[]), t("common.cancel", &[]))).dim()];
    f.render_widget(Clear, box_);
    f.render_widget(Paragraph::new(text).wrap(Wrap { trim: true }).block(Block::bordered().title(Line::from(format!(" {} ", t("live.end", &[]))).bold())), box_);
}

/// What a refusal says: the web's `error.<code>` where it has one, else the code.
pub fn refusal_text(code: &str) -> String {
    let key = format!("error.{code}");
    let said = t(&key, &[]);
    if said == key { code.to_string() } else { said }
}

/// The text's key for why an item has no slides, as the Mac app's `problemKey`.
fn problem_key(problem: &str) -> String {
    let key = match problem {
        "song-trashed" => "songTrashed",
        "song-missing" => "songMissing",
        "image-missing" => "imageMissing",
        "audio-missing" => "audioMissing",
        _ => "empty",
    };
    format!("presentation.{key}")
}

/// "#c73448", as the core gives a label's colour.
fn hex(s: &str) -> Color {
    let v = u32::from_str_radix(s.trim_start_matches('#'), 16).unwrap_or(0xffffff);
    Color::Rgb((v >> 16) as u8, (v >> 8) as u8, v as u8)
}
