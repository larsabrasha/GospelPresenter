// The presentation's menu behind its title (the web's PresentationMenu.tsx, the Mac app's title menu): what it offers
// is the core's (`presentationActionsView`), drawn as GNOME's popover menu. Noter och länkar opens the songs' sheet
// music, recordings and links (`presentationMaterialsView`); Radera presentation, asked first, puts it in the trash and
// goes back to the start page (a template's Radera mall); Spara som mall asks for a name (templates.rs); Redigera
// detaljer opens the details (details.rs).
use crate::shell::Shell;
use adw::prelude::*;
use gp_tui::texts::t;
use gtk::gio;
use serde_json::{json, Value};
use std::rc::Rc;

/// The entries this app draws.
const DRAWN: [&str; 4] = ["editDetails", "materials", "saveAsTemplate", "trash"];

/// The menu's model and its actions (`presentation.*`) for the open presentation, set on `button`.
pub fn attach(shell: &Rc<Shell>, button: &gtk::MenuButton) {
    let (pid, name, live, template) = {
        let m = shell.model.borrow();
        let p = m.app.page.as_ref().and_then(|p| p.presentation.clone());
        let template = p.as_ref().is_some_and(|p| p.is_template);
        (p.as_ref().map(|p| p.id.clone()).unwrap_or_default(), p.map(|p| p.name).unwrap_or_default(), m.app.is_live(), template)
    };
    // The role the app opens the database as (Shell::start's caller, the demo's admin) until it signs in to a host.
    let args = json!({ "isTemplate": template, "presenting": live, "role": "admin" });
    let groups = shell.model.borrow().app.core().call("presentationActionsView", args).ok()
        .and_then(|v| v["groups"].as_array().cloned()).unwrap_or_default();
    let menu = gio::Menu::new();
    let actions = gio::SimpleActionGroup::new();
    for group in &groups {
        let section = gio::Menu::new();
        for a in group["actions"].as_array().into_iter().flatten() {
            let id = a["id"].as_str().unwrap_or("");
            if !DRAWN.contains(&id) { continue }
            section.append(Some(&t(a["text"].as_str().unwrap_or(""), &[])), Some(&format!("presentation.{id}")));
            let action = gio::SimpleAction::new(id, None);
            let (weak, pid, name, id) = (Rc::downgrade(shell), pid.clone(), name.clone(), id.to_string());
            action.connect_activate(move |_, _| {
                let Some(s) = weak.upgrade() else { return };
                match id.as_str() {
                    "editDetails" => crate::details::edit(&s, &pid),
                    "materials" => materials(&s, &pid),
                    "saveAsTemplate" => crate::templates::save_as(&s),
                    _ => ask_trash(&s, &pid, &name, template),
                }
            });
            actions.add_action(&action);
        }
        if section.n_items() > 0 { menu.append_section(None, &section) }
    }
    button.insert_action_group("presentation", Some(&actions));
    button.set_menu_model(Some(&menu));
}

/// Noter och länkar: each song with materials a group, in the running order; a link opened in the browser.
fn materials(shell: &Rc<Shell>, pid: &str) {
    let answer = shell.model.borrow().app.core().call("presentationMaterialsView", json!({ "presentationId": pid })).unwrap_or(Value::Null);
    let page = adw::PreferencesPage::new();
    for song in answer["songs"].as_array().into_iter().flatten() {
        let group = adw::PreferencesGroup::builder().title(song["title"].as_str().unwrap_or("")).build();
        for m in song["materials"].as_array().into_iter().flatten() {
            let link = m["kind"] == json!("link");
            let row = adw::ActionRow::builder().title(m["title"].as_str().unwrap_or("")).activatable(link).build();
            row.add_prefix(&gtk::Image::from_icon_name(if link { "web-browser-symbolic" } else { "text-x-generic-symbolic" }));
            if let Some(url) = m["url"].as_str().filter(|_| link).map(String::from) {
                row.add_suffix(&gtk::Image::from_icon_name("adw-external-link-symbolic"));
                let window = shell.window.clone();
                row.connect_activated(move |_| gtk::UriLauncher::new(&url).launch(Some(&window), gio::Cancellable::NONE, |_| {}));
            }
            group.add(&row);
        }
        page.add(&group);
    }
    if let Some(empty) = answer["empty"].as_str() {
        let status = adw::StatusPage::builder().icon_name("mail-attachment-symbolic").description(t(empty, &[])).build();
        let group = adw::PreferencesGroup::new();
        group.add(&status);
        page.add(&group);
    }
    let view = adw::ToolbarView::new();
    view.add_top_bar(&adw::HeaderBar::new());
    view.set_content(Some(&page));
    let dialog = adw::Dialog::builder().title(t("material.title", &[])).content_width(480).content_height(520).child(&view).build();
    dialog.present(Some(&shell.window));
}

/// Radera presentation (or mall), asked first; then back to the start page.
fn ask_trash(shell: &Rc<Shell>, pid: &str, name: &str, template: bool) {
    let (title, confirm) = if template { ("templates.trash", "templates.trashConfirm") } else { ("presentation.trash", "presentation.trashConfirm") };
    let dialog = adw::AlertDialog::new(Some(&t(title, &[])), Some(&t(confirm, &[("name", name)])));
    dialog.add_responses(&[("cancel", &t("common.cancel", &[])), ("trash", &t(title, &[]))]);
    dialog.set_response_appearance("trash", adw::ResponseAppearance::Destructive);
    dialog.set_close_response("cancel");
    let (weak, pid) = (Rc::downgrade(shell), pid.to_string());
    dialog.connect_response(None, move |_, response| {
        if response != "trash" { return }
        let Some(s) = weak.upgrade() else { return };
        let at = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis() as i64);
        s.trash_presentation(&pid, at, template);
    });
    dialog.present(Some(&shell.window));
}
