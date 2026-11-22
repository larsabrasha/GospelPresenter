// A presentation's page on a computer (the Mac app's WideLayout.swift, the web's PresentationEditor.tsx): the bar with
// the title, when and where (LIVE first while presented) and ▶ Starta or ■ Avsluta (pageButtonsView's
// `presentationBar`; ‹ back is the header bar's own); the running order at the left, every item's slides in the middle
// under its heading, and while presenting the live column at the right with the picture and Släck
// (presentationColumnsView, pageButtonsView's `liveColumn`); an item's menu on its row and its heading (item_menu.rs),
// and Markera's select mode in the running order (ticking.rs). Not built yet: Lägg till, the description card, folding
// and resizing the columns, the outputs and overlays in the live column, dragging.
use crate::shell::Shell;
use crate::{item_menu, presentation_menu, ticking, tiles};
use adw::prelude::*;
use gp_tui::dates::subtitle;
use gp_tui::keys::Action;
use gp_tui::texts::t;
use gp_tui::views::SlideAt;
use serde_json::{json, Value};
use std::rc::Rc;

pub struct Page {
    pub nav_page: adw::NavigationPage,
    title: adw::WindowTitle,
    /// The title as a button, its menu the presentation's (presentation_menu.rs).
    title_menu: gtk::MenuButton,
    bar_buttons: gtk::Box,
    rows: Vec<(String, gtk::ListBoxRow)>,
    /// The running order, or in select mode its ticks (`ticks`).
    order_stack: gtk::Stack,
    ticks: gtk::Box,
    /// Every slide's tile, by its key (`itemId/part`), in the order of the page.
    tiles: Vec<(String, gtk::DrawingArea)>,
    /// The tiles' container, where their places are measured for ↑ ↓ (`placed`).
    slides: gtk::Box,
    live_column: gtk::Box,
    live_picture: gtk::DrawingArea,
    live_buttons: gtk::Box,
    cue: gtk::Label,
}

/// The GNOME symbolic icon for a button's icon of the core's (`icon`), where it has one.
fn icon(name: &str) -> Option<&'static str> {
    match name {
        "play" => Some("media-playback-start-symbolic"),
        "stop" => Some("media-playback-stop-symbolic"),
        "display" => Some("video-display-symbolic"),
        _ => None,
    }
}

/// A button of pageButtonsView, in its role's look (look.rs) and doing its id's event; None for one this page does
/// not draw (‹ back, the header bar's own; folding a column, not built).
fn button(shell: &Rc<Shell>, b: &Value) -> Option<gtk::Button> {
    let id = b["id"].as_str()?;
    let event = match id {
        "start" | "end" | "black" => json!({ "type": id }),
        _ => return None,
    };
    let text = t(b["text"].as_str().unwrap_or(""), &[]);
    let content = adw::ButtonContent::builder().label(&text).build();
    if let Some(name) = b["icon"].as_str().and_then(icon) { content.set_icon_name(name) }
    let button = gtk::Button::builder().child(&content).tooltip_text(&text).sensitive(b["enabled"].as_bool().unwrap_or(true)).build();
    match b["role"].as_str() {
        Some("start") => button.add_css_class("start"),
        Some("end") => button.add_css_class("end"),
        Some("quiet") => button.add_css_class("flat"),
        _ => {}
    }
    let weak = Rc::downgrade(shell);
    button.connect_clicked(move |_| if let Some(s) = weak.upgrade() { s.act(Action::Event(event.clone())) });
    Some(button)
}

fn replace(container: &gtk::Box, buttons: Vec<gtk::Button>) {
    while let Some(child) = container.first_child() { container.remove(&child) }
    for b in buttons { container.append(&b) }
}

impl Page {
    pub fn build(shell: &Rc<Shell>) -> Page {
        let m = shell.model.borrow();
        let page = m.app.page.clone().expect("a presentation open");
        let p = page.presentation.clone().expect("a presentation");
        let title = adw::WindowTitle::new(&p.name, "");
        let header = adw::HeaderBar::new();
        let title_menu = gtk::MenuButton::builder().child(&title).css_classes(["flat"]).build();
        header.set_title_widget(Some(&title_menu));
        let bar_buttons = gtk::Box::new(gtk::Orientation::Horizontal, 6);
        header.pack_end(&bar_buttons);

        // The running order: each item a row, a click its `select`.
        let order = gtk::ListBox::builder().selection_mode(gtk::SelectionMode::None).css_classes(["navigation-sidebar"]).build();
        let mut rows = vec![];
        for item in &page.items {
            let label = gtk::Label::builder().label(&item.title).xalign(0.0).ellipsize(gtk::pango::EllipsizeMode::End)
                .margin_top(10).margin_bottom(10).margin_start(6).build();
            let row = gtk::ListBoxRow::builder().child(&label).build();
            menu_on(shell, &item.id, &row);
            order.append(&row);
            rows.push((item.id.clone(), row));
        }
        let weak = Rc::downgrade(shell);
        let ids: Vec<String> = page.items.iter().map(|i| i.id.clone()).collect();
        order.connect_row_activated(move |_, row| {
            let Some(id) = ids.get(row.index() as usize) else { return };
            if let Some(s) = weak.upgrade() { s.act(Action::Event(json!({ "type": "select", "itemId": id }))) }
        });
        let (_, order_width) = m.column("runningOrder");
        let order_scroll = gtk::ScrolledWindow::builder().child(&order).hscrollbar_policy(gtk::PolicyType::Never).vexpand(true).build();
        let ticks = gtk::Box::new(gtk::Orientation::Vertical, 0);
        // Its width the column's, the select mode's bar (which spreads its buttons apart) not widening it.
        let order_stack = gtk::Stack::builder().width_request(order_width).hexpand(false).build();
        order_stack.add_named(&order_scroll, Some("order"));
        order_stack.add_named(&ticks, Some("ticks"));

        // Every item's slides under its heading.
        let slides = gtk::Box::new(gtk::Orientation::Vertical, 0);
        slides.set_margin_start(12);
        slides.set_margin_end(12);
        slides.set_margin_bottom(24);
        let mut tiles = vec![];
        for item in &page.items {
            let heading = gtk::Box::new(gtk::Orientation::Horizontal, 4);
            heading.append(&gtk::Label::builder().label(&item.title).xalign(0.0).css_classes(["slide-heading"]).build());
            let more = gtk::Button::builder().icon_name("view-more-symbolic").css_classes(["flat", "circular"]).valign(gtk::Align::Center)
                .tooltip_text(t("live.itemMore", &[("title", &item.title)])).build();
            let (weak, id) = (Rc::downgrade(shell), item.id.clone());
            more.connect_clicked(move |b| if let Some(s) = weak.upgrade() { item_menu::pop_up(&s, &id, b) });
            heading.append(&more);
            slides.append(&heading);
            if let Some(problem) = page.problem_of(&item.id) {
                slides.append(&gtk::Label::builder().label(t(problem, &[])).xalign(0.0).css_classes(["dim-label"]).build());
            }
            let flow = gtk::FlowBox::builder().selection_mode(gtk::SelectionMode::None).homogeneous(true)
                .column_spacing(12).row_spacing(12).max_children_per_line(12).build();
            for n in 0..page.slides_of(&item.id).len() {
                let tile = tiles::tile(shell, &p.id, SlideAt { item_id: item.id.clone(), part_index: n as i64 }, n + 1);
                flow.append(&tile);
                tiles.push((format!("{}/{n}", item.id), tile));
            }
            slides.append(&flow);
        }
        let slides_scroll = gtk::ScrolledWindow::builder().child(&slides).hexpand(true).hscrollbar_policy(gtk::PolicyType::Never).build();

        // The live column: the picture, then Släck; the cue under them.
        let live_picture = tiles::live_picture(shell, true);
        let frame = gtk::AspectFrame::builder().ratio(16.0 / 9.0).obey_child(false).child(&live_picture).build();
        let live_buttons = gtk::Box::new(gtk::Orientation::Horizontal, 6);
        live_buttons.set_halign(gtk::Align::Center);
        let cue = gtk::Label::builder().wrap(true).css_classes(["dim-label"]).build();
        let (_, live_width) = m.column("live");
        let live_column = gtk::Box::builder().orientation(gtk::Orientation::Vertical).spacing(12).width_request(live_width)
            .margin_top(12).margin_bottom(12).margin_start(12).margin_end(12).build();
        live_column.append(&frame);
        live_column.append(&live_buttons);
        live_column.append(&cue);

        let content = gtk::Box::new(gtk::Orientation::Horizontal, 0);
        content.append(&order_stack);
        content.append(&gtk::Separator::new(gtk::Orientation::Vertical));
        content.append(&slides_scroll);
        content.append(&live_column);
        let bar = adw::ToolbarView::new();
        bar.add_top_bar(&header);
        bar.set_content(Some(&content));
        let nav_page = adw::NavigationPage::builder().title(&p.name).child(&bar).build();
        Page { nav_page, title, title_menu, bar_buttons, rows, order_stack, ticks, tiles, slides, live_column, live_picture, live_buttons, cue }
    }

    /// Whether the page was built for these items, in this order with these titles: else it is built again.
    pub fn built_for(&self, page: &gp_tui::views::PresentationPage) -> bool {
        self.rows.len() == page.items.len() && self.rows.iter().zip(&page.items).all(|((id, row), i)| {
            id == &i.id && row.child().and_downcast::<gtk::Label>().is_some_and(|l| l.label() == i.title)
        })
    }

    /// Every tile as it stands now, for ↑ ↓ (the core's `slideAcrossView`): its key and its box in the slides'
    /// column; a tile not laid out yet is left out.
    pub fn placed(&self) -> Vec<Value> {
        self.tiles.iter().filter_map(|(key, tile)| {
            let r = tile.compute_bounds(&self.slides)?;
            Some(json!({ "key": key, "left": r.x(), "top": r.y(), "right": r.x() + r.width(), "bottom": r.y() + r.height() }))
        }).collect()
    }

    /// What the model now has: the title's line, the bar's button, the item selected, every tile's marks, the live
    /// column out while presenting with its picture, Släck and the cue.
    pub fn refresh(&self, shell: &Rc<Shell>) {
        let m = shell.model.borrow();
        let app = &m.app;
        let Some(page) = app.page.as_ref() else { return };
        if let Some(p) = &page.presentation {
            let when = subtitle(p, &app.today, true, true);
            let line = if app.is_live() { [t("live.badge", &[]), when].iter().filter(|s| !s.is_empty()).cloned().collect::<Vec<_>>().join(" · ") } else { when };
            self.title.set_subtitle(&line);
        }
        presentation_menu::attach(shell, &self.title_menu);
        replace(&self.bar_buttons, m.buttons("presentationBar").iter().filter_map(|b| button(shell, b)).collect());
        for (id, row) in &self.rows {
            if app.state.selected_id.as_deref() == Some(id.as_str()) { row.add_css_class("selected-item") } else { row.remove_css_class("selected-item") }
        }
        for (_, tile) in &self.tiles { tile.queue_draw() }
        match &m.ticking {
            Some(state) => {
                ticking::fill(shell, &self.ticks, page, state);
                self.order_stack.set_visible_child_name("ticks");
            }
            None => self.order_stack.set_visible_child_name("order"),
        }
        let (out, _) = m.column("live");
        self.live_column.set_visible(out);
        if out {
            replace(&self.live_buttons, m.buttons("liveColumn").iter().filter_map(|b| button(shell, b)).collect());
            self.live_picture.queue_draw();
        }
        let cue = app.cue.as_ref().map(|c| {
            let item = page.item(&c.item_id).map_or(String::new(), |i| i.title.clone());
            t(&c.text, &[("n", &c.n.to_string()), ("item", &item)])
        });
        self.cue.set_label(cue.as_deref().unwrap_or(""));
    }
}

/// An item's menu on `widget`: a right click, or a long press on a touch screen (GNOME's lists).
fn menu_on(shell: &Rc<Shell>, item_id: &str, widget: &impl IsA<gtk::Widget>) {
    let click = gtk::GestureClick::builder().button(3).build();
    let (weak, id, at) = (Rc::downgrade(shell), item_id.to_string(), widget.clone().upcast::<gtk::Widget>());
    click.connect_pressed(move |_, _, _, _| if let Some(s) = weak.upgrade() { item_menu::pop_up(&s, &id, &at) });
    widget.add_controller(click);
    let press = gtk::GestureLongPress::builder().touch_only(true).build();
    let (weak, id, at) = (Rc::downgrade(shell), item_id.to_string(), widget.clone().upcast::<gtk::Widget>());
    press.connect_pressed(move |_, _, _| if let Some(s) = weak.upgrade() { item_menu::pop_up(&s, &id, &at) });
    widget.add_controller(press);
}
