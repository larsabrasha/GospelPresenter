// Papperskorg (the Mac app's SettingsTrash.swift, the web's Trash.tsx), as the core lays it out (`trashPageView`): the
// kinds the member manages, newest deletion first, each with its days left in words (red at a day or less); a kind's
// tab where there are two or more; a search by name (or a song's author); Återställ on each row and Radera permanent
// in its menu, asked first; the rows counted; Töm papperskorgen last, in red, asked first. Opening it purges what has
// passed its 30 days, as the web's does. Picking several rows at once is not built here.
use crate::shell::Shell;
use adw::prelude::*;
use gp_tui::texts::t;
use serde::Deserialize;
use serde_json::json;
use std::cell::RefCell;
use std::rc::Rc;

#[derive(Deserialize, Clone)]
struct Words { key: String, n: i64 }
#[derive(Deserialize, Clone)]
struct Entry { kind: String, id: String, name: String, detail: Option<String>, restore: String, purge: String, left: Words, urgent: bool }
#[derive(Deserialize)]
struct Page { entries: Vec<Entry>, kinds: Vec<String>, kind: Option<String>, total: i64, expired: bool, count: Words }

fn words(w: &Words) -> String { t(&w.key, &[("n", &w.n.to_string())]) }

fn now_ms() -> i64 { std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis() as i64) }

/// The GNOME symbolic icon of an entry's kind.
fn icon(kind: &str) -> &'static str {
    match kind {
        "Presentation" => "x-office-presentation-symbolic",
        "Template" => "text-x-generic-symbolic",
        "Song" => "audio-x-generic-symbolic",
        "Image" => "image-x-generic-symbolic",
        "Audio" => "audio-volume-high-symbolic",
        "Video" => "video-x-generic-symbolic",
        _ => "view-paged-symbolic",
    }
}

struct Trash {
    shell: Rc<Shell>,
    root: gtk::Box,
    tabs: gtk::Box,
    list: adw::PreferencesPage,
    groups: RefCell<Vec<adw::PreferencesGroup>>,
    kind: RefCell<Option<String>>,
    query: RefCell<String>,
    /// When the page was opened: the days left are counted from it, as the Mac's and the web's.
    opened: i64,
}

impl Trash {
    fn read(&self) -> Option<Page> {
        let args = json!({ "role": crate::settings::role(&self.shell), "now": self.opened, "kind": *self.kind.borrow(), "query": *self.query.borrow() });
        self.shell.model.borrow().app.core().call("trashPageView", args).ok().and_then(|v| serde_json::from_value(v).ok())
    }

    /// The tabs, the rows, the count and Töm papperskorgen as the trash now holds them.
    fn fill(self: &Rc<Self>) {
        for g in self.groups.borrow_mut().drain(..) { self.list.remove(&g) }
        while let Some(c) = self.tabs.first_child() { self.tabs.remove(&c) }
        let Some(page) = self.read() else { return };
        *self.kind.borrow_mut() = page.kind.clone();
        self.tabs.set_visible(page.kinds.len() > 1);
        let mut first: Option<gtk::ToggleButton> = None;
        for kind in std::iter::once(None).chain(page.kinds.iter().cloned().map(Some)) {
            let label = kind.as_ref().map_or_else(|| t("trash.all", &[]), |k| t(&format!("trash.kind.{k}"), &[]));
            let tab = gtk::ToggleButton::builder().label(label).active(kind == page.kind).build();
            if let Some(f) = &first { tab.set_group(Some(f)) } else { first = Some(tab.clone()) }
            let me = Rc::downgrade(self);
            tab.connect_toggled(move |b| if b.is_active() { if let Some(m) = me.upgrade() { *m.kind.borrow_mut() = kind.clone(); m.fill() } });
            self.tabs.append(&tab);
        }
        let group = adw::PreferencesGroup::new();
        if page.total == 0 {
            group.add(&adw::StatusPage::builder().icon_name("user-trash-symbolic").title(t("trash.emptyTitle", &[])).build());
        } else if page.entries.is_empty() {
            group.add(&adw::StatusPage::builder().icon_name("system-search-symbolic").title(t("trash.noMatch", &[])).build());
        } else {
            group.set_description(Some(&words(&page.count)));
        }
        for e in &page.entries { group.add(&self.row(e)) }
        self.list.add(&group);
        self.groups.borrow_mut().push(group);
        if page.total > 0 {
            let empty = adw::PreferencesGroup::new();
            let button = adw::ButtonRow::builder().title(t("trash.empty", &[])).build();
            // Added to its own classes, not in their place: a ButtonRow's look is its classes.
            button.add_css_class("destructive-action");
            let (me, n) = (Rc::downgrade(self), page.total);
            button.connect_activated(move |_| if let Some(m) = me.upgrade() {
                let me = Rc::downgrade(&m);
                m.ask(&t("trash.empty", &[]), &t("trash.emptyConfirm", &[("n", &n.to_string())]), move || if let Some(m) = me.upgrade() { m.change("emptyTrash", json!({})) });
            });
            empty.add(&button);
            self.list.add(&empty);
            self.groups.borrow_mut().push(empty);
        }
    }

    fn row(self: &Rc<Self>, e: &Entry) -> adw::ActionRow {
        let what = [Some(t(&format!("trash.one.{}", e.kind), &[])), e.detail.clone()].into_iter().flatten().filter(|s| !s.is_empty()).collect::<Vec<_>>().join(" · ");
        let left = gtk::glib::markup_escape_text(&words(&e.left));
        let left = if e.urgent { format!("<span foreground=\"#ef4444\">{left}</span>") } else { left.to_string() };
        let row = adw::ActionRow::builder().title(gtk::glib::markup_escape_text(&e.name).as_str()).subtitle(format!("{} · {left}", gtk::glib::markup_escape_text(&what))).build();
        row.add_prefix(&gtk::Image::from_icon_name(icon(&e.kind)));
        let restore = gtk::Button::builder().label(t("common.restore", &[])).valign(gtk::Align::Center).build();
        let (me, entry) = (Rc::downgrade(self), e.clone());
        restore.connect_clicked(move |_| if let Some(m) = me.upgrade() { m.change(&entry.restore, json!({ "id": entry.id })) });
        row.add_suffix(&restore);
        // Radera permanent, asked first, in the row's menu.
        let menu = gtk::gio::Menu::new();
        menu.append(Some(&t("trash.purge", &[])), Some("row.purge"));
        let actions = gtk::gio::SimpleActionGroup::new();
        let purge = gtk::gio::SimpleAction::new("purge", None);
        let (me, entry) = (Rc::downgrade(self), e.clone());
        purge.connect_activate(move |_, _| if let Some(m) = me.upgrade() {
            let (me, entry) = (Rc::downgrade(&m), entry.clone());
            let text = t(&format!("trash.purgeConfirm.{}", entry.kind), &[("name", &entry.name)]);
            m.ask(&t("trash.purge", &[]), &text, move || if let Some(m) = me.upgrade() { m.change(&entry.purge, json!({ "id": entry.id })) });
        });
        actions.add_action(&purge);
        let more = gtk::MenuButton::builder().icon_name("view-more-symbolic").menu_model(&menu).css_classes(["flat"]).valign(gtk::Align::Center).build();
        more.insert_action_group("row", Some(&actions));
        row.add_suffix(&more);
        row
    }

    /// A question with Avbryt and the destructive answer `title`; `then` on yes.
    fn ask(&self, title: &str, text: &str, then: impl Fn() + 'static) {
        let dialog = adw::AlertDialog::new(Some(title), Some(text));
        dialog.add_responses(&[("cancel", &t("common.cancel", &[])), ("yes", &t("trash.purge", &[]))]);
        dialog.set_response_appearance("yes", adw::ResponseAppearance::Destructive);
        dialog.set_close_response("cancel");
        dialog.connect_response(None, move |_, r| if r == "yes" { then() });
        dialog.present(Some(&self.root));
    }

    /// A change of the trash, its refusal said; the page and the app's lists read again.
    fn change(self: &Rc<Self>, name: &str, args: serde_json::Value) {
        let refused = { let mut m = self.shell.model.borrow_mut(); if m.app.run(name, args) { None } else { m.app.refusal.take() } };
        self.shell.model.borrow_mut().app.load_start();
        crate::start_page::fill(&self.shell);
        self.fill();
        if let Some(code) = refused { crate::settings_mine::said(&self.shell, &crate::settings_mine::refusal(&code)) }
    }
}

/// Papperskorg's page, with its state, which the caller keeps while the page is shown.
pub fn page(shell: &Rc<Shell>) -> (gtk::Box, Rc<dyn std::any::Any>) {
    let root = gtk::Box::new(gtk::Orientation::Vertical, 0);
    let search = gtk::SearchEntry::builder().placeholder_text(t("trash.search", &[])).margin_start(12).margin_end(12).margin_top(12).build();
    let tabs = gtk::Box::builder().css_classes(["linked"]).halign(gtk::Align::Center).margin_top(12).build();
    let list = adw::PreferencesPage::builder().vexpand(true).build();
    root.append(&search);
    root.append(&tabs);
    root.append(&list);
    let trash = Rc::new(Trash { shell: shell.clone(), root: root.clone(), tabs, list, groups: RefCell::new(vec![]), kind: RefCell::new(None), query: RefCell::new(String::new()), opened: now_ms() });
    // What has expired is purged on opening (PRES-R26); not asked for, so a refusal leaves the entries.
    if trash.read().is_some_and(|p| p.expired) {
        shell.model.borrow_mut().app.run("purgeExpiredTrash", json!({ "now": trash.opened }));
        shell.model.borrow_mut().app.refusal.take();
    }
    trash.fill();
    let me = Rc::downgrade(&trash);
    search.connect_search_changed(move |s| if let Some(m) = me.upgrade() { *m.query.borrow_mut() = s.text().to_string(); m.fill() });
    (root, trash)
}
