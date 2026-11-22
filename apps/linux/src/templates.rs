// Skapa presentation and templates (spec 03; the web's Presentations.tsx and Templates.tsx, the Mac app's
// Templates.swift): + on the start page offers a blank presentation or one of the templates last used (`templatesView`
// with `recent`), then the details, from a template its name, next date, time and place (`templateView`) and a copy of
// its items (`createFromTemplate`); Mallar lists the templates with their slot and makes one, opened as a
// presentation's page is; Spara som mall is in a presentation's menu (presentation_menu.rs).
use crate::shell::Shell;
use adw::prelude::*;
use gp_tui::texts::t;
use serde_json::{json, Value};
use std::rc::Rc;

fn core(shell: &Rc<Shell>, view: &str, args: Value) -> Value { shell.model.borrow().app.core().call(view, args).unwrap_or(Value::Null) }

fn new_id() -> String { gtk::glib::uuid_string_random().to_string() }

fn now_ms() -> i64 { std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis() as i64) }

/// The templates, every one or the picker's last used.
fn templates(shell: &Rc<Shell>, recent: bool) -> Vec<Value> {
    core(shell, "templatesView", json!({ "locale": "sv", "recent": recent })).as_array().cloned().unwrap_or_default()
}

/// A template's slot as the core says it, for today and the time now.
fn slot(shell: &Rc<Shell>, tp: &Value) -> Value {
    let now = gtk::glib::DateTime::now_local().ok();
    let clock = now.as_ref().and_then(|d| d.format("%H:%M").ok()).map(|s| s.to_string()).unwrap_or_default();
    let today = shell.model.borrow().app.today.clone();
    core(shell, "templateView", json!({ "template": { "weekday": tp["weekday"], "time": tp["time"], "location": tp["location"] }, "today": today, "now": clock }))
}

/// "Söndag 11:00 · Kyrkan".
fn line(shell: &Rc<Shell>, tp: &Value) -> String {
    let s = slot(shell, tp);
    let schedule: Vec<String> = [s["schedule"]["day"].as_str().map(|k| t(k, &[])), s["schedule"]["time"].as_str().map(String::from)].into_iter().flatten().collect();
    [schedule.join(" "), s["location"].as_str().unwrap_or("").to_string()].into_iter().filter(|x| !x.is_empty()).collect::<Vec<_>>().join(" · ")
}

/// A dialog with a header bar, its title, and its confirm button at the end.
fn dialog(title: &str, content: &impl IsA<gtk::Widget>, confirm: Option<&gtk::Button>) -> adw::Dialog {
    let header = adw::HeaderBar::new();
    if let Some(b) = confirm { b.add_css_class("suggested-action"); header.pack_end(b) }
    let view = adw::ToolbarView::new();
    view.add_top_bar(&header);
    view.set_content(Some(content));
    adw::Dialog::builder().title(title).content_width(460).child(&view).build()
}

/// A row of a template: its name and its line.
fn template_row(shell: &Rc<Shell>, tp: &Value) -> adw::ActionRow {
    let row = adw::ActionRow::builder().title(tp["name"].as_str().unwrap_or("")).subtitle(line(shell, tp)).activatable(true).use_markup(false).build();
    row.add_suffix(&gtk::Image::from_icon_name("go-next-symbolic"));
    row
}

/// Skapa presentation: the templates to start from, or the details at once when there are none.
pub fn create(shell: &Rc<Shell>) {
    let recent = templates(shell, true);
    if recent.is_empty() { return details(shell, None) }
    let page = adw::PreferencesPage::new();
    let blank_group = adw::PreferencesGroup::new();
    let blank = adw::ActionRow::builder().title(t("templates.blank", &[])).activatable(true).build();
    blank_group.add(&blank);
    page.add(&blank_group);
    let group = adw::PreferencesGroup::builder().title(t("templates.pickerTitle", &[])).build();
    let manage = gtk::Button::builder().label(t("templates.manage", &[])).css_classes(["flat"]).build();
    group.set_header_suffix(Some(&manage));
    page.add(&group);
    let dialog = dialog(&t("presentations.createTitle", &[]), &page, None);
    dialog.set_content_height(520);
    let (weak, d) = (Rc::downgrade(shell), dialog.clone());
    blank.connect_activated(move |_| if let Some(s) = weak.upgrade() { d.close(); details(&s, None) });
    for tp in recent {
        let row = template_row(shell, &tp);
        let (weak, d) = (Rc::downgrade(shell), dialog.clone());
        row.connect_activated(move |_| if let Some(s) = weak.upgrade() { d.close(); details(&s, Some(tp.clone())) });
        group.add(&row);
    }
    let (weak, d) = (Rc::downgrade(shell), dialog.clone());
    manage.connect_clicked(move |_| if let Some(s) = weak.upgrade() { d.close(); list(&s) });
    dialog.present(Some(&shell.window));
}

/// The details of a new presentation, from a template prefilled; made and opened.
fn details(shell: &Rc<Shell>, template: Option<Value>) {
    let next = template.as_ref().map(|tp| slot(shell, tp)["nextDate"].as_str().unwrap_or("").to_string()).unwrap_or_default();
    let name = adw::EntryRow::builder().title(t("presentation.name", &[])).text(template.as_ref().and_then(|tp| tp["name"].as_str()).unwrap_or(&t("presentations.defaultName", &[]))).build();
    let date = adw::EntryRow::builder().title(t("presentation.date", &[])).text(&next).build();
    let time = adw::EntryRow::builder().title(t("presentation.time", &[])).text(template.as_ref().and_then(|tp| tp["time"].as_str()).unwrap_or("")).build();
    let place = adw::EntryRow::builder().title(t("presentation.location", &[])).text(template.as_ref().and_then(|tp| tp["location"].as_str()).unwrap_or("")).build();
    let group = adw::PreferencesGroup::new();
    for r in [&name, &date, &time, &place] { group.add(r) }
    let page = adw::PreferencesPage::new();
    page.add(&group);
    let create = gtk::Button::builder().label(t("common.create", &[])).build();
    let dialog = dialog(&t("presentations.createTitle", &[]), &page, Some(&create));
    dialog.set_content_height(420);
    let (weak, d) = (Rc::downgrade(shell), dialog.clone());
    create.connect_clicked(move |_| {
        let Some(s) = weak.upgrade() else { return };
        let text = |e: &adw::EntryRow| { let v = e.text().trim().to_string(); if v.is_empty() { Value::Null } else { json!(v) } };
        let id = new_id();
        let mut args = json!({ "id": id, "name": name.text().to_string(), "eventDate": text(&date), "time": text(&time), "location": place.text().to_string(), "description": "" });
        let command = match &template {
            Some(tp) => {
                let items = core(&s, "itemsView", json!({ "presentationId": tp["id"] }));
                args["templateId"] = tp["id"].clone();
                args["items"] = json!(items.as_array().into_iter().flatten().map(|i| json!({ "from": i["id"], "id": new_id() })).collect::<Vec<_>>());
                args["at"] = json!(now_ms());
                "createFromTemplate"
            }
            None => "createPresentation",
        };
        if s.model.borrow_mut().app.run(command, args) {
            d.close();
            s.open(&id);
        } else {
            s.refresh();
        }
    });
    dialog.present(Some(&shell.window));
}

/// Mallar: every template with its slot, one made, one opened.
pub fn list(shell: &Rc<Shell>) {
    let page = adw::PreferencesPage::new();
    let group = adw::PreferencesGroup::builder().title(t("nav.templates", &[])).build();
    let add = gtk::Button::builder().label(t("common.create", &[])).build();
    let dialog = dialog(&t("nav.templates", &[]), &page, Some(&add));
    dialog.set_content_height(520);
    let all = templates(shell, false);
    if all.is_empty() {
        group.add(&adw::ActionRow::builder().title(t("templates.empty", &[])).build());
    }
    for tp in all {
        let row = template_row(shell, &tp);
        let (weak, d, id) = (Rc::downgrade(shell), dialog.clone(), tp["id"].as_str().unwrap_or("").to_string());
        row.connect_activated(move |_| if let Some(s) = weak.upgrade() { d.close(); s.open(&id) });
        group.add(&row);
    }
    page.add(&group);
    let (weak, d) = (Rc::downgrade(shell), dialog.clone());
    add.connect_clicked(move |_| if let Some(s) = weak.upgrade() { d.close(); new_template(&s) });
    dialog.present(Some(&shell.window));
}

/// Skapa mall: its name, day of the week, time and place; made and opened.
fn new_template(shell: &Rc<Shell>) {
    let name = adw::EntryRow::builder().title(t("presentation.name", &[])).build();
    let days = [1, 2, 3, 4, 5, 6, 0];
    let names: Vec<String> = std::iter::once(t("schedule.noDay", &[])).chain(days.iter().map(|d| t(&format!("weekday.{d}"), &[]))).collect();
    let day = adw::ComboRow::builder().title(t("schedule.day", &[])).model(&gtk::StringList::new(&names.iter().map(String::as_str).collect::<Vec<_>>())).build();
    let time = adw::EntryRow::builder().title(t("schedule.time", &[])).build();
    let place = adw::EntryRow::builder().title(t("schedule.location", &[])).build();
    let group = adw::PreferencesGroup::new();
    group.add(&name);
    group.add(&day);
    group.add(&time);
    group.add(&place);
    let page = adw::PreferencesPage::new();
    page.add(&group);
    let create = gtk::Button::builder().label(t("common.create", &[])).build();
    let dialog = dialog(&t("templates.createTitle", &[]), &page, Some(&create));
    dialog.set_content_height(420);
    let (weak, d) = (Rc::downgrade(shell), dialog.clone());
    create.connect_clicked(move |_| {
        let Some(s) = weak.upgrade() else { return };
        let id = new_id();
        let weekday = match day.selected() { 0 => Value::Null, n => json!(days[(n - 1) as usize]) };
        let time = time.text().trim().to_string();
        let args = json!({ "id": id, "name": name.text().to_string(), "weekday": weekday, "time": if time.is_empty() { Value::Null } else { json!(time) }, "location": place.text().to_string() });
        if s.model.borrow_mut().app.run("createTemplate", args) { d.close(); s.open(&id) } else { s.refresh() }
    });
    dialog.present(Some(&shell.window));
}

/// Spara som mall: the open presentation's items copied into a template of the name asked.
pub fn save_as(shell: &Rc<Shell>) {
    let (pid, name, items) = {
        let m = shell.model.borrow();
        let Some(page) = m.app.page.as_ref() else { return };
        let p = page.presentation.clone();
        (p.as_ref().map(|p| p.id.clone()).unwrap_or_default(), p.map(|p| p.name).unwrap_or_default(), page.items.iter().map(|i| i.id.clone()).collect::<Vec<_>>())
    };
    let ask = adw::AlertDialog::new(Some(&t("templates.saveAs", &[])), None);
    let entry = gtk::Entry::builder().text(&name).activates_default(true).build();
    ask.set_extra_child(Some(&entry));
    ask.add_responses(&[("cancel", &t("common.cancel", &[])), ("save", &t("common.save", &[]))]);
    ask.set_response_appearance("save", adw::ResponseAppearance::Suggested);
    ask.set_default_response(Some("save"));
    ask.set_close_response("cancel");
    let weak = Rc::downgrade(shell);
    ask.connect_response(None, move |_, response| {
        let (Some(s), true) = (weak.upgrade(), response == "save") else { return };
        let copies: Vec<Value> = items.iter().map(|i| json!({ "from": i, "id": new_id() })).collect();
        let args = json!({ "id": new_id(), "presentationId": pid, "name": entry.text().to_string(), "items": copies });
        if s.model.borrow_mut().app.run("saveAsTemplate", args) {
            let toast = adw::AlertDialog::new(Some(&t("templates.savedAs", &[])), None);
            toast.add_response("ok", "OK");
            toast.present(Some(&s.window));
        }
    });
    ask.present(Some(&shell.window));
}
