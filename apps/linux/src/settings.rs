// Inställningar (the Mac app's Settings.swift, docs/layout-2-0.md): a window of its own as GNOME Settings, the list at
// the left (the core's `settingsListView`, Mina inställningar as a profile cell at its top, a search above it through
// `settingsSearchView`) and the page chosen at the right. A shell draws the pages it has: Mina inställningar
// (settings_mine.rs), Etiketter (settings_labels.rs), Papperskorg (settings_trash.rs) and Om Gospel Presenter here; the list's other rows are left out until their pages are built
// (docs/native-parity.md).
use crate::shell::Shell;
use adw::prelude::*;
use gp_tui::texts::t;
use serde::Deserialize;
use serde_json::json;
use std::rc::Rc;

/// The pages this shell has.
const BUILT: &[&str] = &["settings", "labels", "trash", "about"];

#[derive(Deserialize, Clone)]
pub struct Shade { pub name: String, pub hex: String }
#[derive(Deserialize, Clone)]
pub struct SettingsRow { pub id: String, pub text: String, pub icon: String, pub colour: Shade, pub r#where: Option<String> }
#[derive(Deserialize)]
struct Group { title: Option<String>, rows: Vec<SettingsRow> }

/// The role the list is for: the signed-in member's, the demo's admin.
pub fn role(shell: &Rc<Shell>) -> String {
    shell.sync.borrow().as_ref().map_or("admin".into(), |s| s.session.me.role.clone())
}

/// The GNOME symbolic icon of a row's icon (settings_models.rs), as near as GNOME has one.
fn icon(name: &str) -> &'static str {
    match name {
        "song" => "audio-x-generic-symbolic",
        "bible" => "accessories-dictionary-symbolic",
        "image" => "image-x-generic-symbolic",
        "audio" => "audio-volume-high-symbolic",
        "video" => "video-x-generic-symbolic",
        "slides" => "x-office-presentation-symbolic",
        "display" => "video-display-symbolic",
        "users" => "system-users-symbolic",
        "devices" => "phone-symbolic",
        "trash" => "user-trash-symbolic",
        "about" => "help-about-symbolic",
        "bug" => "dialog-warning-symbolic",
        "label" => "tag-symbolic",
        _ => "emblem-system-symbolic",
    }
}

/// A row's icon in its coloured square, as GNOME Settings' and iOS's are drawn.
fn square(row: &SettingsRow) -> gtk::Image {
    let image = gtk::Image::builder().icon_name(icon(&row.icon)).css_classes(["settings-icon", &format!("sq-{}", row.colour.name)]).build();
    image.set_valign(gtk::Align::Center);
    image
}

/// The list's colours as CSS, each square's class its colour's name.
fn colours(rows: &[SettingsRow]) {
    let mut css = String::from(".settings-icon { color: white; border-radius: 7px; padding: 5px; }\n");
    for r in rows { css += &format!(".sq-{} {{ background-color: {}; }}\n", r.colour.name, r.colour.hex) }
    let provider = gtk::CssProvider::new();
    provider.load_from_string(&css);
    if let Some(display) = gtk::gdk::Display::default() {
        gtk::style_context_add_provider_for_display(&display, &provider, gtk::STYLE_PROVIDER_PRIORITY_APPLICATION);
    }
}

fn labelled(title: &str, sub: Option<&str>, prefix: impl IsA<gtk::Widget>) -> gtk::ListBoxRow {
    let line = gtk::Box::builder().orientation(gtk::Orientation::Horizontal).spacing(10).margin_top(6).margin_bottom(6).build();
    line.append(&prefix);
    let words = gtk::Box::new(gtk::Orientation::Vertical, 1);
    words.append(&gtk::Label::builder().label(title).xalign(0.0).build());
    if let Some(sub) = sub { words.append(&gtk::Label::builder().label(sub).xalign(0.0).css_classes(["dim-label", "caption"]).build()) }
    line.append(&words);
    gtk::ListBoxRow::builder().child(&line).build()
}

struct Window {
    shell: Rc<Shell>,
    list: gtk::ListBox,
    content: adw::NavigationPage,
    ids: std::cell::RefCell<Vec<String>>,
    /// The state of the page shown, kept while it is.
    shown: std::cell::RefCell<Option<Rc<dyn std::any::Any>>>,
}

impl Window {
    /// The list, or what the search finds.
    fn fill(&self, query: &str) {
        while let Some(c) = self.list.first_child() { self.list.remove(&c) }
        let mut ids = vec![];
        let role = role(&self.shell);
        let model = self.shell.model.borrow();
        let core = model.app.core();
        if query.trim().is_empty() {
            let me = self.shell.sync.borrow().as_ref().map_or_else(|| t("nav.settings", &[]), |s| s.session.me.name.clone());
            let letter = gtk::Label::builder().label(me.chars().next().map(|c| c.to_uppercase().to_string()).unwrap_or_default())
                .css_classes(["account-letter"]).valign(gtk::Align::Center).build();
            self.list.append(&labelled(&me, Some(&t("nav.settings", &[])), letter));
            ids.push("settings".into());
            let groups: Vec<Group> = core.call("settingsListView", json!({ "role": role, "host": false })).ok()
                .and_then(|v| serde_json::from_value(v).ok()).unwrap_or_default();
            for g in groups {
                let rows: Vec<_> = g.rows.into_iter().filter(|r| BUILT.contains(&r.id.as_str())).collect();
                if rows.is_empty() { continue }
                // A group without a title (Papperskorg, Om) follows on after a gap, as the Mac's list.
                let head = gtk::Label::builder().label(g.title.map(|k| t(&k, &[])).unwrap_or_default()).xalign(0.0)
                    .css_classes(["heading", "dim-label"]).margin_top(6).margin_start(6).build();
                let header = gtk::ListBoxRow::builder().child(&head).activatable(false).selectable(false).build();
                self.list.append(&header);
                ids.push(String::new());
                for r in rows {
                    self.list.append(&labelled(&t(&r.text, &[]), None, square(&r)));
                    ids.push(r.id);
                }
            }
        } else {
            let keys: Vec<String> = core.call("settingsSearchKeysView", json!({})).ok().and_then(|v| serde_json::from_value(v).ok()).unwrap_or_default();
            let texts: serde_json::Map<String, serde_json::Value> = keys.iter().map(|k| (k.clone(), json!(t(k, &[])))).collect();
            let found: Vec<SettingsRow> = core.call("settingsSearchView", json!({ "role": role, "host": false, "query": query, "texts": texts })).ok()
                .and_then(|v| serde_json::from_value(v).ok()).unwrap_or_default();
            let found: Vec<_> = found.into_iter().filter(|r| BUILT.contains(&r.id.as_str())).collect();
            if found.is_empty() {
                let none = gtk::Label::builder().label(t("search.none", &[("query", query.trim())])).css_classes(["dim-label"]).margin_top(12).wrap(true).build();
                self.list.append(&gtk::ListBoxRow::builder().child(&none).activatable(false).selectable(false).build());
                ids.push(String::new());
            }
            for r in found {
                let sub = r.r#where.as_deref().map(|w| t(w, &[]));
                self.list.append(&labelled(&t(&r.text, &[]), sub.as_deref(), square(&r)));
                ids.push(r.id);
            }
        }
        *self.ids.borrow_mut() = ids;
    }

    /// The page `id` at the right.
    fn show(self: &Rc<Self>, id: &str) {
        let (title, page): (String, gtk::Widget) = match id {
            "settings" => {
                let (page, state) = crate::settings_mine::page(&self.shell);
                *self.shown.borrow_mut() = Some(state);
                (t("nav.settings", &[]), page.upcast())
            }
            "labels" => {
                let (page, state) = crate::settings_labels::page(&self.shell);
                *self.shown.borrow_mut() = Some(state);
                (t("nav.labels", &[]), page.upcast())
            }
            "trash" => {
                let (page, state) = crate::settings_trash::page(&self.shell);
                *self.shown.borrow_mut() = Some(state);
                (t("trash.title", &[]), page.upcast())
            }
            "about" => (t("nav.about", &[]), about(&self.shell).upcast()),
            _ => return,
        };
        let view = adw::ToolbarView::new();
        view.add_top_bar(&adw::HeaderBar::builder().show_title(true).build());
        view.set_content(Some(&page));
        self.content.set_title(&title);
        self.content.set_child(Some(&view));
    }
}

/// Inställningar, at Mina inställningar.
pub fn open(shell: &Rc<Shell>) {
    let all: Vec<Group> = shell.model.borrow().app.core().call("settingsListView", json!({ "role": "superAdmin", "host": true })).ok().and_then(|v| serde_json::from_value(v).ok()).unwrap_or_default();
    colours(&all.into_iter().flat_map(|g| g.rows).collect::<Vec<_>>());
    let list = gtk::ListBox::builder().css_classes(["navigation-sidebar"]).build();
    let search = gtk::SearchEntry::builder().placeholder_text(t("search.field", &[])).margin_start(6).margin_end(6).margin_bottom(6).build();
    let side = adw::ToolbarView::new();
    side.add_top_bar(&adw::HeaderBar::new());
    side.add_top_bar(&search);
    side.set_content(Some(&gtk::ScrolledWindow::builder().child(&list).hscrollbar_policy(gtk::PolicyType::Never).build()));
    let sidebar = adw::NavigationPage::builder().title(t("nav.admin", &[])).child(&side).build();
    let content = adw::NavigationPage::builder().title(t("nav.settings", &[])).build();
    let split = adw::NavigationSplitView::builder().sidebar(&sidebar).content(&content).min_sidebar_width(240.0).build();
    let window = adw::Window::builder().title(t("nav.admin", &[])).default_width(960).default_height(680).content(&split).transient_for(&shell.window).build();
    // A phone's width: the list alone, a row's page pushed over it, as GNOME Settings collapses.
    let narrow = adw::Breakpoint::new(adw::BreakpointCondition::parse("max-width: 600sp").expect("a breakpoint"));
    narrow.add_setter(&split, "collapsed", Some(&true.to_value()));
    window.add_breakpoint(narrow);
    // Typing anywhere in the window searches, as GNOME Settings does.
    search.set_key_capture_widget(Some(&window));
    let w = Rc::new(Window { shell: shell.clone(), list: list.clone(), content, ids: Default::default(), shown: Default::default() });
    w.fill("");
    let me = Rc::downgrade(&w);
    list.connect_row_activated(move |_, row| {
        let Some(w) = me.upgrade() else { return };
        let id = w.ids.borrow().get(row.index() as usize).cloned().unwrap_or_default();
        if id.is_empty() { return }
        w.show(&id);
        split.set_show_content(true);
    });
    let me = Rc::downgrade(&w);
    search.connect_search_changed(move |s| if let Some(w) = me.upgrade() { w.fill(&s.text()) });
    w.show("settings");
    if let Some(first) = list.row_at_index(0) { list.select_row(Some(&first)) }
    // The window keeps its page's state alive while open.
    let kept = std::cell::RefCell::new(Some(w));
    window.connect_close_request(move |_| { kept.borrow_mut().take(); gtk::glib::Propagation::Proceed });
    window.present();
}

/// Om Gospel Presenter (the Mac app's AboutPage): the app, what it is, its core's version and who made it.
fn about(shell: &Rc<Shell>) -> adw::PreferencesPage {
    let page = adw::PreferencesPage::new();
    let head = adw::PreferencesGroup::new();
    let status = adw::StatusPage::builder().icon_name("x-office-presentation-symbolic").title("Gospel Presenter").description(t("about.tagline", &[])).build();
    head.add(&status);
    page.add(&head);
    let facts = adw::PreferencesGroup::new();
    let info = shell.model.borrow().app.core().call("coreInfoView", json!({})).unwrap_or_default();
    let core = match (info["name"].as_str(), info["version"].as_str()) {
        (Some(name), Some(version)) => t("about.coreValue", &[("name", name), ("version", version)]),
        _ => t("about.unknown", &[]),
    };
    let fact = |title: &str, value: &str| {
        let row = adw::ActionRow::builder().title(title).build();
        row.add_suffix(&gtk::Label::builder().label(value).css_classes(["dim-label"]).selectable(true).build());
        row
    };
    facts.add(&fact(&t("about.version", &[]), env!("CARGO_PKG_VERSION")));
    facts.add(&fact(&t("about.core", &[]), &core));
    page.add(&facts);
    let credits = adw::PreferencesGroup::builder().description(t("about.credits", &[])).build();
    page.add(&credits);
    page
}
