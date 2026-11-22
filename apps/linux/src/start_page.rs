// The start page (apps/mac/Sources/GPMac/StartPage.swift): what this device presents at the top ("Visas just nu"),
// then the core's lists (startPageView: Idag, Kommande, Senast ändrade), each row the presentation's name, its date,
// time and place, and its number of items; a row opens it. + makes a presentation (templates.rs, from a template or
// blank), the header's menu has Mallar; signed in to a host, the user's letter is the account's menu (the sync's
// problem while it has one, Synka nu, Logga ut). Not built yet: Visa fler.
use crate::shell::Shell;
use adw::prelude::*;
use gp_tui::dates::written;
use gp_tui::texts::t;
use gp_tui::views::PresentationRow;
use std::rc::Rc;

/// The page's content made again from the model's lists.
pub fn fill(shell: &Rc<Shell>) {
    let page = adw::PreferencesPage::new();
    let m = shell.model.borrow();
    let live = m.app.live.presentation_id.clone();
    let rows: Vec<&PresentationRow> = m.app.rows();
    if let Some(p) = live.as_deref().and_then(|id| rows.iter().find(|r| r.id == id)) {
        let group = adw::PreferencesGroup::builder().title(t("remote.nowShowing", &[])).build();
        group.add(&row(shell, p, &written(&p.line), true));
        page.add(&group);
    }
    // Visas just nu elsewhere: sessions that allow remote control, each with Ta kontroll (none while presenting here).
    let drivable = if live.is_some() { vec![] } else { crate::live::with(|l| l.state.controllable.clone()).unwrap_or_default() };
    if !drivable.is_empty() {
        let group = adw::PreferencesGroup::builder().title(t("remote.nowShowing", &[])).build();
        for s in &drivable { group.add(&drivable_row(shell, s)) }
        page.add(&group);
    }
    for list in &m.app.lists {
        let group = adw::PreferencesGroup::builder().title(t(&list.title, &[])).build();
        for p in &list.rows {
            group.add(&row(shell, p, &written(&p.line), live.as_deref() == Some(p.id.as_str())));
        }
        page.add(&group);
    }
    let header = adw::HeaderBar::new();
    let add = gtk::Button::builder().icon_name("list-add-symbolic").tooltip_text(t("presentations.new", &[])).build();
    let weak = Rc::downgrade(shell);
    add.connect_clicked(move |_| if let Some(s) = weak.upgrade() { crate::templates::create(&s) });
    header.pack_start(&add);
    let menu = gtk::gio::Menu::new();
    menu.append(Some(&t("nav.templates", &[])), Some("start.templates"));
    let actions = gtk::gio::SimpleActionGroup::new();
    let templates = gtk::gio::SimpleAction::new("templates", None);
    let weak = Rc::downgrade(shell);
    templates.connect_activate(move |_, _| if let Some(s) = weak.upgrade() { crate::templates::list(&s) });
    actions.add_action(&templates);
    let more = gtk::MenuButton::builder().icon_name("open-menu-symbolic").menu_model(&menu).build();
    more.insert_action_group("start", Some(&actions));
    header.pack_end(&more);
    if let Some(account) = account(shell) { header.pack_end(&account) }
    let bar = adw::ToolbarView::new();
    bar.add_top_bar(&header);
    bar.set_content(Some(&page));
    shell.start_page().set_child(Some(&bar));
}

/// A presentation's row: two lines, LIVE first while presented, the number of items at the right.
fn row(shell: &Rc<Shell>, p: &PresentationRow, sub: &str, live: bool) -> adw::ActionRow {
    let row = adw::ActionRow::builder().title(&p.name).subtitle(sub).use_markup(false).activatable(true).build();
    if live {
        let badge = gtk::Label::new(Some(&t("live.badge", &[])));
        badge.add_css_class("live-badge");
        row.add_prefix(&badge);
    }
    let n = p.item_count;
    let count = if n == 1 { t("presentations.item", &[]) } else { t("presentations.items", &[("n", &n.to_string())]) };
    let label = gtk::Label::new(Some(&count));
    label.add_css_class("dim-label");
    row.add_suffix(&label);
    row.add_suffix(&gtk::Image::from_icon_name("go-next-symbolic"));
    let (weak, id) = (Rc::downgrade(shell), p.id.clone());
    row.connect_activated(move |_| if let Some(s) = weak.upgrade() { s.open(&id) });
    row
}

/// Signed in: the user's letter, its menu the name, the sync's problem while it has one (a dot on the letter), Synka nu
/// and Logga ut (the Mac app's AccountMenu).
fn account(shell: &Rc<Shell>) -> Option<gtk::MenuButton> {
    let name = shell.sync.borrow().as_ref()?.session.me.name.clone();
    let problem = crate::sync::problem(shell);
    let menu = gtk::gio::Menu::new();
    let section = gtk::gio::Menu::new();
    if let Some(p) = &problem { section.append(Some(p), Some("account.none")) }
    section.append(Some(&t("status.syncNow", &[])), Some("account.sync"));
    section.append(Some(&t("auth.signOut", &[])), Some("account.signOut"));
    menu.append_section(Some(&name), &section);
    let actions = gtk::gio::SimpleActionGroup::new();
    let none = gtk::gio::SimpleAction::new("none", None);
    none.set_enabled(false);
    actions.add_action(&none);
    let sync = gtk::gio::SimpleAction::new("sync", None);
    let weak = Rc::downgrade(shell);
    sync.connect_activate(move |_, _| if let Some(s) = weak.upgrade() { crate::sync::request(&s) });
    actions.add_action(&sync);
    let sign_out = gtk::gio::SimpleAction::new("signOut", None);
    let weak = Rc::downgrade(shell);
    sign_out.connect_activate(move |_, _| if let Some(s) = weak.upgrade() { s.sign_out() });
    actions.add_action(&sign_out);
    let letter = gtk::Label::new(Some(&name.chars().next().map(|c| c.to_uppercase().to_string()).unwrap_or_default()));
    letter.add_css_class("account-letter");
    if problem.is_some() { letter.add_css_class("account-problem") }
    let button = gtk::MenuButton::builder().child(&letter).menu_model(&menu).tooltip_text(&name).css_classes(["flat", "circular"]).build();
    button.insert_action_group("account", Some(&actions));
    Some(button)
}

/// A session presented elsewhere: its presentation and device, and Ta kontroll.
fn drivable_row(shell: &Rc<Shell>, s: &serde_json::Value) -> adw::ActionRow {
    let row = adw::ActionRow::builder().title(s["presentationName"].as_str().unwrap_or("")).subtitle(s["deviceName"].as_str().unwrap_or("")).use_markup(false).build();
    let take = gtk::Button::builder().label(t("remote.takeControl", &[])).valign(gtk::Align::Center).css_classes(["suggested-action"]).build();
    let (weak, id, pid) = (Rc::downgrade(shell), s["id"].as_str().unwrap_or("").to_string(), s["presentationId"].as_str().unwrap_or("").to_string());
    take.connect_clicked(move |_| if let Some(sh) = weak.upgrade() { sh.take_control(&id, &pid) });
    row.add_suffix(&take);
    row
}
