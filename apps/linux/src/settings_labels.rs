// Etiketter (the Mac app's LabelsPage and LabelSheet in SettingsLists.swift, the web's Labels.tsx): the organisation's
// labels as coloured chips in their order (`labelsView`), the page's intro card, moved up or down from a chip's menu,
// Radera asked first (a label has no trash, and the songs' parts lose it); + makes one and a click on a chip changes
// it, in a dialog: its text (at most the core's `maxLength`), its colour among the swatches with its own as a last one
// (`labelColoursView`) or one of its own, and Radera for one that is there. Shift+Enter, when making one, makes it and
// empties the field for the next (SONG-A28). Picking several at once and dragging are not built here.
use crate::shell::Shell;
use adw::prelude::*;
use gp_tui::texts::t;
use serde::Deserialize;
use serde_json::{json, Value};
use std::cell::RefCell;
use std::rc::Rc;

#[derive(Deserialize, Clone)]
struct Label { id: String, text: String, color: String }
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Colours { swatches: Vec<String>, chosen: String, max_length: i32 }

/// A colour of the page's as GDK reads it, grey where it does not read.
fn rgba(css: &str) -> gtk::gdk::RGBA { gtk::gdk::RGBA::parse(css).unwrap_or(gtk::gdk::RGBA::new(0.42, 0.45, 0.5, 1.0)) }

fn hex(c: &gtk::gdk::RGBA) -> String {
    let n = |v: f32| (v.clamp(0.0, 1.0) * 255.0).round() as u8;
    format!("#{:02x}{:02x}{:02x}", n(c.red()), n(c.green()), n(c.blue()))
}

/// A round swatch, ringed while chosen.
fn swatch(colour: &str, chosen: bool) -> gtk::DrawingArea {
    let area = gtk::DrawingArea::builder().content_width(32).content_height(32).build();
    let c = rgba(colour);
    area.set_draw_func(move |a, cr, w, h| {
        let (cx, cy) = (f64::from(w) / 2.0, f64::from(h) / 2.0);
        cr.set_source_rgba(c.red().into(), c.green().into(), c.blue().into(), 1.0);
        cr.arc(cx, cy, 12.0, 0.0, std::f64::consts::TAU);
        let _ = cr.fill();
        if chosen {
            let fg = a.color();
            cr.set_source_rgba(fg.red().into(), fg.green().into(), fg.blue().into(), 1.0);
            cr.set_line_width(2.0);
            cr.arc(cx, cy, 15.0, 0.0, std::f64::consts::TAU);
            let _ = cr.stroke();
        }
    });
    area
}

/// The swatches, the one chosen ringed; a click chooses another.
struct Palette { shell: Rc<Shell>, grid: gtk::FlowBox, chosen: Rc<RefCell<String>> }

impl Palette {
    fn draw(self: &Rc<Self>) {
        while let Some(c) = self.grid.first_child() { self.grid.remove(&c) }
        let now = self.chosen.borrow().clone();
        // A colour of its own chosen since is a last swatch of its own: the core's (`labelColoursView`).
        let all = self.shell.model.borrow().app.core().call("labelColoursView", json!({ "color": now })).ok()
            .and_then(|v| serde_json::from_value::<Colours>(v).ok()).map(|c| c.swatches).unwrap_or_default();
        for c in all {
            let area = swatch(&c, c.eq_ignore_ascii_case(&now));
            let click = gtk::GestureClick::new();
            let me = Rc::downgrade(self);
            click.connect_released(move |_, _, _, _| if let Some(p) = me.upgrade() { *p.chosen.borrow_mut() = c.clone(); p.draw() });
            area.add_controller(click);
            self.grid.append(&area);
        }
    }
}

struct Labels { shell: Rc<Shell>, page: adw::PreferencesPage, groups: RefCell<Vec<adw::PreferencesGroup>> }

impl Labels {
    fn read(&self) -> Vec<Label> {
        self.shell.model.borrow().app.core().call("labelsView", json!({})).ok().and_then(|v| serde_json::from_value(v).ok()).unwrap_or_default()
    }

    fn colours(&self, color: Option<&str>) -> Option<Colours> {
        let args = color.map_or(json!({}), |c| json!({ "color": c }));
        self.shell.model.borrow().app.core().call("labelColoursView", args).ok().and_then(|v| serde_json::from_value(v).ok())
    }

    /// A change of the labels, its refusal given back; the page drawn again.
    fn change(self: &Rc<Self>, name: &str, args: Value) -> Option<String> {
        let refused = { let mut m = self.shell.model.borrow_mut(); if m.app.run(name, args) { None } else { m.app.refusal.take() } };
        self.fill();
        refused.map(|c| crate::settings_mine::refusal(&c))
    }

    fn fill(self: &Rc<Self>) {
        for g in self.groups.borrow_mut().drain(..) { self.page.remove(&g) }
        let labels = self.read();
        let group = adw::PreferencesGroup::builder().description(t("intro.labels", &[])).build();
        let add = gtk::Button::builder().icon_name("list-add-symbolic").tooltip_text(t("labels.addTitle", &[])).css_classes(["flat"]).valign(gtk::Align::Center).build();
        let me = Rc::downgrade(self);
        add.connect_clicked(move |_| if let Some(m) = me.upgrade() { m.sheet(None) });
        group.set_header_suffix(Some(&add));
        if labels.is_empty() {
            group.add(&adw::StatusPage::builder().icon_name("tag-symbolic").title(t("labels.empty", &[])).build());
        }
        let n = labels.len();
        for (i, l) in labels.iter().enumerate() { group.add(&self.row(l, i, n)) }
        self.page.add(&group);
        self.groups.borrow_mut().push(group);
    }

    /// A label's row: its chip, a click changes it; its menu moves it or removes it.
    fn row(self: &Rc<Self>, l: &Label, at: usize, n: usize) -> adw::ActionRow {
        let chip = gtk::Label::builder().label(&l.text).css_classes(["label-chip"]).valign(gtk::Align::Center).halign(gtk::Align::Start).build();
        let provider = gtk::CssProvider::new();
        provider.load_from_string(&format!("label.label-chip {{ background-color: {}; color: white; border-radius: 999px; padding: 3px 10px; font-weight: 500; }}", hex(&rgba(&l.color))));
        #[allow(deprecated)]
        chip.style_context().add_provider(&provider, gtk::STYLE_PROVIDER_PRIORITY_APPLICATION);
        let row = adw::ActionRow::builder().activatable(true).build();
        row.add_prefix(&chip);
        let (me, label) = (Rc::downgrade(self), l.clone());
        row.connect_activated(move |_| if let Some(m) = me.upgrade() { m.sheet(Some(label.clone())) });
        let menu = gtk::gio::Menu::new();
        if at > 0 { menu.append(Some(&t("labels.moveUp", &[])), Some("label.up")) }
        if at + 1 < n { menu.append(Some(&t("labels.moveDown", &[])), Some("label.down")) }
        menu.append(Some(&t("labels.deleteOne", &[])), Some("label.delete"));
        let actions = gtk::gio::SimpleActionGroup::new();
        for (name, to) in [("up", at.saturating_sub(1)), ("down", at + 1)] {
            let action = gtk::gio::SimpleAction::new(name, None);
            let (me, id) = (Rc::downgrade(self), l.id.clone());
            action.connect_activate(move |_, _| if let Some(m) = me.upgrade() {
                if let Some(e) = m.change("moveLabel", json!({ "id": id, "toIndex": to })) { crate::settings_mine::said(&m.shell, &e) }
            });
            actions.add_action(&action);
        }
        let delete = gtk::gio::SimpleAction::new("delete", None);
        let (me, label) = (Rc::downgrade(self), l.clone());
        delete.connect_activate(move |_, _| if let Some(m) = me.upgrade() { m.ask_delete(&label, None) });
        actions.add_action(&delete);
        let more = gtk::MenuButton::builder().icon_name("view-more-symbolic").menu_model(&menu).css_classes(["flat"]).valign(gtk::Align::Center).build();
        more.insert_action_group("label", Some(&actions));
        row.add_suffix(&more);
        row
    }

    /// Radera, asked first; `then` (a dialog to close) once it is gone.
    fn ask_delete(self: &Rc<Self>, l: &Label, then: Option<adw::Dialog>) {
        let dialog = adw::AlertDialog::new(Some(&t("labels.deleteOne", &[])), Some(&t("labels.deleteConfirm", &[("text", &l.text)])));
        dialog.add_responses(&[("cancel", &t("common.cancel", &[])), ("delete", &t("labels.deleteOne", &[]))]);
        dialog.set_response_appearance("delete", adw::ResponseAppearance::Destructive);
        dialog.set_close_response("cancel");
        let (me, id) = (Rc::downgrade(self), l.id.clone());
        dialog.connect_response(None, move |_, r| {
            let Some(m) = me.upgrade().filter(|_| r == "delete") else { return };
            match m.change("deleteLabel", json!({ "id": id })) {
                Some(e) => crate::settings_mine::said(&m.shell, &e),
                None => if let Some(d) = &then { d.close(); },
            }
        });
        dialog.present(Some(&self.page));
    }

    /// The dialog that makes a label (`None`) or changes one.
    fn sheet(self: &Rc<Self>, label: Option<Label>) {
        let Some(colours) = self.colours(label.as_ref().map(|l| l.color.as_str())) else { return };
        let chosen = Rc::new(RefCell::new(colours.chosen.clone()));
        let entry = adw::EntryRow::builder().title(t("labels.field", &[])).text(label.as_ref().map_or("", |l| l.text.as_str())).build();
        entry.set_max_length(colours.max_length);
        let created = gtk::Label::builder().label(t("labels.created", &[])).css_classes(["dim-label", "caption"]).xalign(0.0).visible(false).build();
        let error = gtk::Label::builder().css_classes(["error"]).wrap(true).xalign(0.0).visible(false).build();
        let fields = adw::PreferencesGroup::new();
        fields.add(&entry);
        let grid = gtk::FlowBox::builder().selection_mode(gtk::SelectionMode::None).max_children_per_line(6).min_children_per_line(6).homogeneous(true).build();
        let other = gtk::ColorDialogButton::builder().dialog(&gtk::ColorDialog::builder().with_alpha(false).build()).rgba(&rgba(&colours.chosen)).valign(gtk::Align::Center).build();
        let other_row = adw::ActionRow::builder().title(t("labels.otherColor", &[])).build();
        other_row.add_suffix(&other);
        let palette = adw::PreferencesGroup::new();
        palette.add(&grid);
        palette.add(&other_row);
        let body = gtk::Box::builder().orientation(gtk::Orientation::Vertical).spacing(12).margin_start(18).margin_end(18).margin_top(12).margin_bottom(18).build();
        body.append(&fields);
        body.append(&created);
        body.append(&palette);
        body.append(&error);
        let palette = Rc::new(Palette { shell: self.shell.clone(), grid: grid.clone(), chosen: chosen.clone() });
        palette.draw();
        let p = palette.clone();
        other.connect_rgba_notify(move |b| { *p.chosen.borrow_mut() = hex(&b.rgba()); p.draw() });
        let cancel = gtk::Button::with_label(&t("common.cancel", &[]));
        let save = gtk::Button::builder().label(t("common.save", &[])).css_classes(["suggested-action"]).sensitive(!entry.text().trim().is_empty()).build();
        let header = adw::HeaderBar::builder().show_end_title_buttons(false).show_start_title_buttons(false).build();
        header.pack_start(&cancel);
        header.pack_end(&save);
        let view = adw::ToolbarView::new();
        view.add_top_bar(&header);
        view.set_content(Some(&body));
        let title = t(if label.is_some() { "labels.editTitle" } else { "labels.addTitle" }, &[]);
        let dialog = adw::Dialog::builder().title(title).content_width(380).child(&view).build();
        if let Some(l) = &label {
            let remove = adw::ButtonRow::builder().title(t("labels.deleteOne", &[])).build();
            remove.add_css_class("destructive-action");
            let (me, l, d) = (Rc::downgrade(self), l.clone(), dialog.clone());
            remove.connect_activated(move |_| if let Some(m) = me.upgrade() { m.ask_delete(&l, Some(d.clone())) });
            let group = adw::PreferencesGroup::new();
            group.add(&remove);
            body.append(&group);
        }
        let d = dialog.downgrade();
        cancel.connect_clicked(move |_| if let Some(d) = d.upgrade() { d.close(); });
        let s = save.downgrade();
        entry.connect_changed(move |e| if let Some(s) = s.upgrade() { s.set_sensitive(!e.text().trim().is_empty()) });
        let (me, d, e, err, chosen2, id) = (Rc::downgrade(self), dialog.downgrade(), entry.downgrade(), error.downgrade(), chosen.clone(), label.as_ref().map(|l| l.id.clone()));
        save.connect_clicked(move |_| {
            let (Some(m), Some(d), Some(e), Some(err)) = (me.upgrade(), d.upgrade(), e.upgrade(), err.upgrade()) else { return };
            let mut args = json!({ "text": e.text().trim(), "color": *chosen2.borrow() });
            let name = match &id { Some(id) => { args["id"] = json!(id); "updateLabel" } None => "createLabel" };
            match m.change(name, args) {
                Some(text) => { err.set_label(&text); err.set_visible(true) }
                None => { d.close(); }
            }
        });
        // Shift+Enter while making one: made, and the field emptied for the next.
        if label.is_none() {
            let keys = gtk::EventControllerKey::new();
            keys.set_propagation_phase(gtk::PropagationPhase::Capture);
            let (me, e, created, err, chosen) = (Rc::downgrade(self), entry.downgrade(), created.downgrade(), error.downgrade(), chosen.clone());
            keys.connect_key_pressed(move |_, key, _, state| {
                if key != gtk::gdk::Key::Return || !state.contains(gtk::gdk::ModifierType::SHIFT_MASK) { return gtk::glib::Propagation::Proceed }
                let (Some(m), Some(e), Some(created), Some(err)) = (me.upgrade(), e.upgrade(), created.upgrade(), err.upgrade()) else { return gtk::glib::Propagation::Stop };
                let text = e.text().trim().to_string();
                if text.is_empty() { return gtk::glib::Propagation::Stop }
                match m.change("createLabel", json!({ "text": text, "color": *chosen.borrow() })) {
                    Some(t) => { err.set_label(&t); err.set_visible(true) }
                    None => { e.set_text(""); created.set_visible(true); err.set_visible(false); e.grab_focus(); }
                }
                gtk::glib::Propagation::Stop
            });
            entry.add_controller(keys);
        }
        dialog.present(Some(&self.page));
        entry.grab_focus();
    }
}

/// Etiketter's page, with its state, which the caller keeps while the page is shown.
pub fn page(shell: &Rc<Shell>) -> (adw::PreferencesPage, Rc<dyn std::any::Any>) {
    let labels = Rc::new(Labels { shell: shell.clone(), page: adw::PreferencesPage::new(), groups: RefCell::new(vec![]) });
    labels.fill();
    (labels.page.clone(), labels)
}
