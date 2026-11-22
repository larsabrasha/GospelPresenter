// A presentation's page on a computer (the Mac app's WideLayout.swift, the web's PresentationEditor.tsx): the bar with
// the title, when and where (LIVE first while presented) and ▶ Starta or ■ Avsluta (pageButtonsView's
// `presentationBar`; ‹ back is the header bar's own); the running order at the left, every item's slides in the middle
// under its heading, and while presenting the live column at the right with the picture and Släck
// (presentationColumnsView, pageButtonsView's `liveColumn`); an item's menu on its row and its heading (item_menu.rs),
// and Markera's select mode in the running order (ticking.rs); the description card at the top of the running order;
// each side column folded by its button at its foot's inner end, and brought back by one at the slides' foot on its
// side (the live column out again at each start). Not built yet: the sync line at the running order's foot, resizing
// the columns, dragging.
use crate::shell::Shell;
use crate::{adding, item_menu, presentation_menu, ticking, tiles};
use adw::prelude::*;
use gp_tui::dates::{line, written};
use gp_tui::keys::Action;
use gp_tui::texts::t;
use gp_tui::views::SlideAt;
use serde_json::{json, Value};
use std::cell::Cell;
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
    /// A video or audio item's controls under the picture (player_bar.rs).
    player_bar: crate::player_bar::PlayerBar,
    live_buttons: gtk::Box,
    cue: gtk::Label,
    /// Överlägg, a switch each, at most one on (the core's), under the cue.
    overlays: gtk::Box,
    /// Utgångar and Tillåt fjärrstyrning (outputs.rs), under the overlays.
    outputs: gtk::Box,
    /// Driving a session elsewhere: said over the page.
    banner: adw::Banner,
    /// The description's card at the top of the running order, and its text.
    description_card: gtk::Box,
    description: gtk::Label,
    /// The running order with its edge, hidden while folded; each folded column's way back over the slides' foot.
    order_side: gtk::Box,
    unfold: [gtk::Button; 2],
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
/// not draw here (‹ back, the header bar's own; a column's fold, at its foot: `fold_button`).
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
        let (description_card, description) = description_card();
        let order_parts = gtk::Box::new(gtk::Orientation::Vertical, 0);
        order_parts.append(&description_card);
        order_parts.append(&order);
        let order_scroll = gtk::ScrolledWindow::builder().child(&order_parts).hscrollbar_policy(gtk::PolicyType::Never).vexpand(true).build();
        // Lägg till under the items: the kinds the core lists (adding.rs).
        let add = gtk::MenuButton::builder().label(t("live.add", &[])).css_classes(["suggested-action", "pill"]).halign(gtk::Align::Start)
            .hexpand(true).menu_model(&adding::kinds_menu(shell, "add")).build();
        add.insert_action_group("add", Some(&adding::kinds_actions(shell, None)));
        // Its foot: Lägg till, and the fold at the inner end, beside the slides.
        let order_foot = gtk::Box::builder().orientation(gtk::Orientation::Horizontal).margin_start(12).margin_end(8).margin_top(8).margin_bottom(12).build();
        order_foot.append(&add);
        order_foot.append(&fold_button(shell, 0, true, &fold_text(&m, "runningOrder")));
        let order_column = gtk::Box::new(gtk::Orientation::Vertical, 0);
        order_column.append(&order_scroll);
        order_column.append(&order_foot);
        let ticks = gtk::Box::new(gtk::Orientation::Vertical, 0);
        // Its width the column's, the select mode's bar (which spreads its buttons apart) not widening it.
        let order_stack = gtk::Stack::builder().width_request(order_width).hexpand(false).build();
        order_stack.add_named(&order_column, Some("order"));
        order_stack.add_named(&ticks, Some("ticks"));

        // Every item's slides under its heading.
        let slides = gtk::Box::new(gtk::Orientation::Vertical, 0);
        slides.set_margin_start(12);
        slides.set_margin_end(12);
        slides.set_margin_bottom(24);
        let mut tiles = vec![];
        let mut flows = vec![];
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
            let flow = gtk::FlowBox::builder().selection_mode(gtk::SelectionMode::None).halign(gtk::Align::Start).css_classes(["slide-grid"])
                .column_spacing(GAP as u32).row_spacing(GAP as u32).build();
            for n in 0..page.slides_of(&item.id).len() {
                let tile = tiles::tile(shell, &p.id, SlideAt { item_id: item.id.clone(), part_index: n as i64 }, n + 1);
                flow.append(&tile);
                tiles.push((format!("{}/{n}", item.id), tile));
            }
            slides.append(&flow);
            flows.push(flow);
        }
        // External: no scrollbar across, nor the tiles' widths widening the column; the grid fits them to it.
        let slides_scroll = gtk::ScrolledWindow::builder().child(&slides).hexpand(true).hscrollbar_policy(gtk::PolicyType::External).build();
        fit_grid(shell, &slides_scroll, flows, tiles.iter().map(|(_, t)| t.clone()).collect());

        // The live column: the picture, then Släck; the cue under them.
        let (live_view, live_picture) = tiles::live_picture(shell, true);
        let frame = gtk::AspectFrame::builder().ratio(16.0 / 9.0).obey_child(false).child(&live_view).build();
        let player_bar = crate::player_bar::PlayerBar::build(shell);
        let live_buttons = gtk::Box::new(gtk::Orientation::Horizontal, 6);
        live_buttons.set_halign(gtk::Align::Center);
        let cue = gtk::Label::builder().wrap(true).css_classes(["dim-label"]).build();
        let (_, live_width) = m.column("live");
        // Its width the column's: Utgångar's rows do not widen it.
        let live_column = gtk::Box::builder().orientation(gtk::Orientation::Vertical).spacing(12).width_request(live_width).hexpand(false)
            .margin_top(12).margin_bottom(12).margin_start(12).margin_end(12).build();
        live_column.append(&frame);
        live_column.append(&player_bar.root);
        live_column.append(&live_buttons);
        live_column.append(&cue);
        let overlays = gtk::Box::new(gtk::Orientation::Vertical, 0);
        live_column.append(&overlays);
        let outputs = gtk::Box::new(gtk::Orientation::Vertical, 0);
        live_column.append(&outputs);
        // Its foot: the fold at the inner end, beside the slides.
        let live_fold = fold_button(shell, 1, true, &fold_text(&m, "liveColumn"));
        live_fold.set_halign(gtk::Align::Start);
        live_fold.set_valign(gtk::Align::End);
        live_fold.set_vexpand(true);
        live_column.append(&live_fold);
        // A folded column's way back, at the slides' foot on its side, clear of their scrollbar.
        let unfold = [fold_button(shell, 0, false, "presentation.showSidebar"), fold_button(shell, 1, false, "presentation.showLiveColumn")];
        let slides_over = gtk::Overlay::builder().child(&slides_scroll).hexpand(true).build();
        for (b, side) in unfold.iter().zip([gtk::Align::Start, gtk::Align::End]) {
            // Dark and round over the slides, seen on a white page and on a black tile alike.
            b.remove_css_class("flat");
            b.add_css_class("osd");
            b.set_halign(side);
            b.set_valign(gtk::Align::End);
            b.set_margin_start(14);
            b.set_margin_bottom(14);
            b.set_margin_end(if side == gtk::Align::End { 30 } else { 14 });
            slides_over.add_overlay(b);
        }

        let order_side = gtk::Box::new(gtk::Orientation::Horizontal, 0);
        order_side.append(&order_stack);
        order_side.append(&gtk::Separator::new(gtk::Orientation::Vertical));
        let content = gtk::Box::new(gtk::Orientation::Horizontal, 0);
        content.append(&order_side);
        content.append(&slides_over);
        content.append(&live_column);
        let bar = adw::ToolbarView::new();
        bar.add_top_bar(&header);
        let banner = adw::Banner::new(&t("remote.banner", &[]));
        bar.add_top_bar(&banner);
        bar.set_content(Some(&content));
        let nav_page = adw::NavigationPage::builder().title(&p.name).child(&bar).build();
        Page { nav_page, title, title_menu, bar_buttons, rows, order_stack, ticks, tiles, slides, live_column, live_picture, player_bar, live_buttons, cue, overlays, outputs, banner,
            description_card, description, order_side, unfold }
    }

    /// The player's controls as it now stands.
    pub fn refresh_player(&self, shell: &Rc<Shell>) { self.player_bar.update(shell) }

    /// Överlägg while presenting: a switch for each of the presentation's overlays, the one shown on; switching one
    /// changes the live state as Visning does (the core's overlay rules: one at a time, black ended).
    fn fill_overlays(&self, shell: &Rc<Shell>, out: bool, pid: Option<String>, shown: Option<String>) {
        while let Some(c) = self.overlays.first_child() { self.overlays.remove(&c) }
        let Some(pid) = pid.filter(|_| out) else { return };
        let list = shell.model.borrow_mut().overlays(&pid);
        if list.is_empty() { return }
        let group = adw::PreferencesGroup::builder().title(t("overlays.title", &[])).build();
        for (id, title) in list {
            let row = adw::SwitchRow::builder().title(&title).active(shown.as_deref() == Some(id.as_str())).use_markup(false).build();
            let weak = Rc::downgrade(shell);
            row.connect_active_notify(move |r| if let Some(s) = weak.upgrade() {
                s.model.borrow_mut().app.apply(json!({ "overlayId": if r.is_active() { json!(id) } else { Value::Null } }));
                s.refresh();
            });
            group.add(&row);
        }
        self.overlays.append(&group);
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
        // A start brings the live column out again (the core's `outOnStart`).
        {
            let mut m = shell.model.borrow_mut();
            let (out, _) = m.column("live");
            if out && !std::mem::replace(&mut m.was_live, out) { m.folded[1] = false }
        }
        let m = shell.model.borrow();
        let app = &m.app;
        let Some(page) = app.page.as_ref() else { return };
        if let Some(p) = &page.presentation {
            // Its name as it now is (Redigera detaljer renames it), and the core's date line, LIVE first while presented here.
            if self.title.title() != p.name { self.title.set_title(&p.name); self.nav_page.set_title(&p.name) }
            self.title.set_subtitle(&written(&line(app.core(), p, &app.today, app.is_live())));
            let text = p.description.as_deref().unwrap_or("").trim();
            if self.description.label() != text { self.description.set_label(text) }
            self.description_card.set_visible(!text.is_empty());
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
        self.order_side.set_visible(!m.folded[0]);
        self.unfold[0].set_visible(m.folded[0]);
        self.live_column.set_visible(out && !m.folded[1]);
        self.unfold[1].set_visible(out && m.folded[1]);
        if out {
            replace(&self.live_buttons, m.buttons("liveColumn").iter().filter_map(|b| button(shell, b)).collect());
            self.live_picture.queue_draw();
            self.player_bar.update(shell);
        }
        self.banner.set_revealed(app.remote);
        let cue = app.cue.as_ref().map(|c| {
            let item = page.item(&c.item_id).map_or(String::new(), |i| i.title.clone());
            t(&c.text, &[("n", &c.n.to_string()), ("item", &item)])
        });
        self.cue.set_label(cue.as_deref().unwrap_or(""));
        let presenting_here = out && !app.remote;
        let (pid, shown_overlay) = (page.presentation.as_ref().map(|p| p.id.clone()), app.live.overlay_id.clone());
        drop(m);
        self.fill_overlays(shell, out, pid, shown_overlay);
        if presenting_here { crate::outputs::fill(shell, &self.outputs) } else { while let Some(c) = self.outputs.first_child() { self.outputs.remove(&c) } }
    }
}

/// A column's text for its fold, the core's (pageButtonsView's `fold` of its place).
fn fold_text(m: &crate::model::Model, place: &str) -> String {
    m.buttons(place).iter().find(|b| b["id"] == "fold").and_then(|b| b["text"].as_str()).unwrap_or("").to_string()
}

/// A column's fold (`fold`), or a folded one's way back: a round quiet button with the side's sidebar icon, the
/// running order's (`side` 0) or the live column's (1).
fn fold_button(shell: &Rc<Shell>, side: usize, fold: bool, text: &str) -> gtk::Button {
    let icon = if side == 0 { "sidebar-show-symbolic" } else { "sidebar-show-right-symbolic" };
    let button = gtk::Button::builder().icon_name(icon).tooltip_text(t(text, &[])).css_classes(["flat", "circular"]).build();
    let weak = Rc::downgrade(shell);
    button.connect_clicked(move |_| if let Some(s) = weak.upgrade() {
        s.model.borrow_mut().folded[side] = fold;
        s.refresh();
    });
    button
}

/// The description's card (the web's Description.tsx): three lines, and mer when there is more, which unfolds the
/// rest, Visa mindre folding it again. Its text is set by refresh. Folded, the text is cut at three lines' height
/// rather than ellipsized: pango counts a label's `lines` in each paragraph, and a description is often a list.
fn description_card() -> (gtk::Box, gtk::Label) {
    let label = gtk::Label::builder().wrap(true).wrap_mode(gtk::pango::WrapMode::WordChar).xalign(0.0).css_classes(["dim-label"]).build();
    // Not a target: the wheel scrolls the running order, not the text inside its card.
    let clip = gtk::ScrolledWindow::builder().child(&label).hscrollbar_policy(gtk::PolicyType::Never).vscrollbar_policy(gtk::PolicyType::External)
        .propagate_natural_height(true).can_target(false).build();
    let more = gtk::Button::builder().label(t("presentation.descriptionMore", &[])).css_classes(["flat", "description-more"]).halign(gtk::Align::End).visible(false).build();
    let card = gtk::Box::builder().orientation(gtk::Orientation::Vertical).css_classes(["card", "description"]).margin_start(12).margin_end(12).margin_top(12).margin_bottom(4).build();
    card.append(&clip);
    card.append(&more);
    let open = Rc::new(Cell::new(false));
    let (c, o) = (clip.clone(), open.clone());
    more.connect_clicked(move |b| {
        o.set(!o.get());
        if o.get() { c.set_max_content_height(-1) }
        b.set_label(&t(if o.get() { "presentation.descriptionLess" } else { "presentation.descriptionMore" }, &[]));
    });
    // While folded, three lines' height, and mer when the text runs past it: again as the width or the text changes.
    let b = more.downgrade();
    clip.add_tick_callback(move |c, _| {
        let Some(b) = b.upgrade() else { return gtk::glib::ControlFlow::Break };
        let Some(l) = c.child().and_then(|v| v.first_child()).or_else(|| c.child()).and_downcast::<gtk::Label>() else { return gtk::glib::ControlFlow::Continue };
        if open.get() || c.width() <= 0 { return gtk::glib::ControlFlow::Continue }
        // The foot of the third line as laid out, or the whole text when it has fewer.
        let layout = l.layout();
        let mut lines = layout.iter();
        let third = lines.next_line() && lines.next_line();
        let limit = if third { let (_, r) = lines.line_extents(); (r.y() + r.height()) / gtk::pango::SCALE } else { layout.pixel_size().1 };
        if c.max_content_height() != limit { c.set_max_content_height(limit) }
        let (_, natural, _, _) = l.measure(gtk::Orientation::Vertical, c.width());
        b.set_visible(natural > limit + 1);
        gtk::glib::ControlFlow::Continue
    });
    (card, label)
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

/// The space between tiles, across and down.
const GAP: i32 = 12;

/// The tiles sized by the core's grid (`slideGridView`) for the column's width, again whenever it changes: as many to
/// a row as fit at 340 to 384, each the stage's shape.
fn fit_grid(shell: &Rc<Shell>, scroll: &gtk::ScrolledWindow, flows: Vec<gtk::FlowBox>, tiles: Vec<gtk::DrawingArea>) {
    let (weak, last) = (Rc::downgrade(shell), std::cell::Cell::new(0));
    // Held weakly: the scroll keeps its callback, and its children must not keep it.
    let flows: Vec<_> = flows.iter().map(|f| f.downgrade()).collect();
    let tiles: Vec<_> = tiles.iter().map(|t| t.downgrade()).collect();
    scroll.add_tick_callback(move |scroll, _| {
        // The slides' box has a margin of 12 at either side.
        let width = scroll.width() - 24;
        if width <= 0 || width == last.get() { return gtk::glib::ControlFlow::Continue }
        let Some(s) = weak.upgrade() else { return gtk::glib::ControlFlow::Break };
        let Ok(m) = s.model.try_borrow() else { return gtk::glib::ControlFlow::Continue };
        let Ok(grid) = m.app.core().call("slideGridView", json!({ "width": width, "spacing": GAP })) else { return gtk::glib::ControlFlow::Continue };
        last.set(width);
        let n = |k: &str| grid[k].as_f64().unwrap_or(1.0) as i32;
        for f in flows.iter().filter_map(|f| f.upgrade()) {
            f.set_min_children_per_line(n("columns") as u32);
            f.set_max_children_per_line(n("columns") as u32);
        }
        for t in tiles.iter().filter_map(|t| t.upgrade()) {
            t.set_content_width(n("tileWidth"));
            t.set_content_height(n("tileHeight"));
        }
        gtk::glib::ControlFlow::Continue
    });
}
