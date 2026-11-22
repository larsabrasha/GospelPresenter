// Lägg till, every kind (the web's AddItemDialog.tsx, the Mac app's SongSheet.swift, AddSheets.swift and
// BibleSheet.swift): from the running order's Lägg till and an item's Lägg till efter ›, the kinds the core lists
// (`pageButtonsView`), each in a dialog that stays open after an add (D15), the next following the last; where an
// addition goes is the core's (`addPositionView`). A song searched (`searchSongsView`); a programme item named; a Bible
// text searched or browsed (`verseSearchPlanView`, `bibleBrowseView`, `bibleSlidesView`); a library's pictures, sounds,
// videos or slideshows picked (`libraryOrderView`, `addPickView`). Not here yet: importing files into a library (the
// app has no media files of its own yet) and a translation not kept on this device.
use crate::shell::Shell;
use adw::prelude::*;
use gp_tui::texts::t;
use gtk::gio;
use serde_json::{json, Value};
use std::cell::RefCell;
use std::rc::Rc;

/// The kinds Lägg till offers, as the core lists them: (id, text key), Programpunkt last, apart.
pub fn kinds(shell: &Rc<Shell>) -> Vec<(String, String)> {
    let buttons = shell.model.borrow().app.core().call("pageButtonsView", json!({ "place": "runningOrder" })).unwrap_or(Value::Null);
    let add = buttons["buttons"].as_array().into_iter().flatten().find(|b| b["id"] == json!("add")).cloned().unwrap_or(Value::Null);
    add["choices"].as_array().into_iter().flatten()
        .filter_map(|c| Some((c["id"].as_str()?.to_string(), c["text"].as_str()?.to_string()))).collect()
}

/// A menu of the kinds, each `<group>.<kind>`; Programpunkt in a section of its own.
pub fn kinds_menu(shell: &Rc<Shell>, group: &str) -> gio::Menu {
    let (menu, main, apart) = (gio::Menu::new(), gio::Menu::new(), gio::Menu::new());
    for (id, text) in kinds(shell) {
        let to = if id == "header" { &apart } else { &main };
        to.append(Some(&t(&text, &[])), Some(&format!("{group}.{id}")));
    }
    menu.append_section(None, &main);
    menu.append_section(None, &apart);
    menu
}

/// The actions of `kinds_menu`, each choosing its kind after `chosen` (none for Lägg till).
pub fn kinds_actions(shell: &Rc<Shell>, chosen: Option<&str>) -> gio::SimpleActionGroup {
    let group = gio::SimpleActionGroup::new();
    for (id, _) in kinds(shell) {
        let action = gio::SimpleAction::new(&id, None);
        let (weak, chosen) = (Rc::downgrade(shell), chosen.map(String::from));
        action.connect_activate(move |_, _| if let Some(s) = weak.upgrade() { choose(&s, &id, chosen.as_deref()) });
        group.add_action(&action);
    }
    group
}

/// Where the next addition goes: after `chosen`, else as the core's one rule says (`addPositionView`).
fn after_for(shell: &Rc<Shell>, chosen: Option<&str>) -> Value {
    let m = shell.model.borrow();
    let app = &m.app;
    let order: Vec<String> = app.page.as_ref().map(|p| p.items.iter().map(|i| i.id.clone()).collect()).unwrap_or_default();
    let shown = if app.is_live() { json!(app.live.item_id) } else { Value::Null };
    let args = json!({ "order": order, "shownId": shown, "lastAddedId": app.state.last_added_id, "chosenId": chosen, "selectedId": app.state.selected_id });
    app.core().call("addPositionView", args).unwrap_or(Value::Null)
}

/// A kind chosen: its dialog, or for Programpunkt its name asked.
pub fn choose(shell: &Rc<Shell>, kind: &str, chosen: Option<&str>) {
    let after = after_for(shell, chosen);
    match kind {
        "header" => header(shell, after),
        "song" => song(shell, after),
        "bible" => crate::adding_bible::open(shell, after),
        k => library(shell, k, after),
    }
}

fn new_id() -> String { gtk::glib::uuid_string_random().to_string() }

fn pid(shell: &Rc<Shell>) -> String { shell.model.borrow().app.open_id().unwrap_or_default().to_string() }

/// An item added by `command`: the page drawn again, the item selected and the next addition following it.
pub fn added(shell: &Rc<Shell>, command: &str, args: Value) -> bool {
    let item = args["itemId"].as_str().unwrap_or_default().to_string();
    shell.run(command, args);
    let ok = shell.model.borrow().app.page.as_ref().is_some_and(|p| p.item(&item).is_some());
    if ok {
        shell.model.borrow_mut().app.send(json!({ "type": "added", "itemId": item }));
        shell.refresh();
    }
    ok
}

/// A dialog of the add kinds: a header bar with Lägg till, the content under it.
pub fn dialog(title: &str, content: &impl IsA<gtk::Widget>, add: &gtk::Button) -> adw::Dialog {
    let header = adw::HeaderBar::new();
    add.add_css_class("suggested-action");
    header.pack_end(add);
    let view = adw::ToolbarView::new();
    view.add_top_bar(&header);
    view.set_content(Some(content));
    adw::Dialog::builder().title(title).content_width(640).content_height(620).child(&view).build()
}

/// Programpunkt: its name asked, then added.
fn header(shell: &Rc<Shell>, after: Value) {
    let ask = adw::AlertDialog::new(Some(&t("header.new", &[])), None);
    let entry = gtk::Entry::builder().placeholder_text(t("header.name", &[])).activates_default(true).build();
    ask.set_extra_child(Some(&entry));
    ask.add_responses(&[("cancel", &t("common.cancel", &[])), ("add", &t("presentation.add", &[]))]);
    ask.set_response_appearance("add", adw::ResponseAppearance::Suggested);
    ask.set_default_response(Some("add"));
    ask.set_close_response("cancel");
    let weak = Rc::downgrade(shell);
    ask.connect_response(None, move |_, response| {
        let (Some(s), true) = (weak.upgrade(), response == "add") else { return };
        let args = json!({ "itemId": new_id(), "presentationId": pid(&s), "title": entry.text().to_string(), "afterItemId": after });
        added(&s, "addHeaderToPresentation", args);
    });
    ask.present(Some(&shell.window));
}

/// Sång: the library searched, a song picked and added in its own arrangement.
fn song(shell: &Rc<Shell>, after: Value) {
    let search = gtk::SearchEntry::builder().placeholder_text(t("presentation.searchSongs", &[])).build();
    let list = gtk::ListBox::builder().css_classes(["boxed-list"]).build();
    let content = gtk::Box::builder().orientation(gtk::Orientation::Vertical).spacing(12).margin_start(18).margin_end(18).margin_bottom(18).build();
    content.append(&search);
    content.append(&gtk::ScrolledWindow::builder().child(&list).vexpand(true).build());
    let add = gtk::Button::builder().label(t("presentation.add", &[])).sensitive(false).build();
    let dialog = dialog(&t("presentation.addKind", &[("kind", &t("add.song", &[]).to_lowercase())]), &content, &add);
    let after = Rc::new(RefCell::new(after));
    let fill = {
        let (weak, list) = (Rc::downgrade(shell), list.clone());
        move |q: &str| {
            let Some(s) = weak.upgrade() else { return };
            while let Some(c) = list.first_child() { list.remove(&c) }
            let hits = s.model.borrow().app.core().call("searchSongsView", json!({ "query": q, "locale": "sv" })).unwrap_or(Value::Null);
            for h in hits.as_array().into_iter().flatten() {
                let row = adw::ActionRow::builder().title(h["name"].as_str().unwrap_or("")).subtitle(h["author"].as_str().unwrap_or("")).build();
                row.set_widget_name(h["id"].as_str().unwrap_or(""));
                list.append(&row);
            }
            if let Some(first) = list.row_at_index(0) { list.select_row(Some(&first)) }
        }
    };
    // Lägg till follows the row chosen, the first chosen by each search.
    let a = add.clone();
    list.connect_row_selected(move |_, row| a.set_sensitive(row.is_some()));
    fill("");
    search.connect_search_changed(move |e| fill(&e.text()));
    let (weak, l) = (Rc::downgrade(shell), list.clone());
    add.connect_clicked(move |_| {
        let (Some(s), Some(row)) = (weak.upgrade(), l.selected_row()) else { return };
        let id = new_id();
        let args = json!({ "itemId": id, "presentationId": pid(&s), "songId": row.widget_name().to_string(), "arrangementId": null, "afterItemId": *after.borrow() });
        if added(&s, "addSongToPresentation", args) { *after.borrow_mut() = json!(id) }
    });
    dialog.present(Some(&shell.window));
}

/// Bild, Ljud, Video or Bildspel: the library's, searched, picked as the core says (pictures many in the order tapped,
/// the rest one), added by the core's command.
fn library(shell: &Rc<Shell>, kind: &str, after: Value) {
    let (library, text) = match kind {
        "image" => ("images", "add.image"),
        "audio" => ("audios", "presentation.audioTab"),
        "video" => ("videos", "presentation.videoTab"),
        _ => ("customSlides", "add.slides"),
    };
    let search = gtk::SearchEntry::builder().placeholder_text(t("presentation.searchImages", &[])).build();
    let list = gtk::ListBox::builder().selection_mode(gtk::SelectionMode::None).css_classes(["boxed-list"]).build();
    let content = gtk::Box::builder().orientation(gtk::Orientation::Vertical).spacing(12).margin_start(18).margin_end(18).margin_bottom(18).build();
    content.append(&search);
    content.append(&gtk::ScrolledWindow::builder().child(&list).vexpand(true).build());
    let add = gtk::Button::builder().label(t("presentation.add", &[])).sensitive(false).build();
    let dialog = dialog(&t("presentation.addKind", &[("kind", &t(text, &[]).to_lowercase())]), &content, &add);
    let state = Rc::new(RefCell::new((Vec::<String>::new(), after)));
    let pick = {
        let (weak, kind, state) = (Rc::downgrade(shell), kind.to_string(), state.clone());
        move |event: Option<Value>| -> Value {
            let Some(s) = weak.upgrade() else { return Value::Null };
            let (picked, after) = state.borrow().clone();
            let mut args = json!({ "kind": kind, "picked": picked, "presentationId": pid(&s), "itemId": new_id(), "afterItemId": after });
            if let Some(e) = event { args["event"] = e }
            let answer = s.model.borrow().app.core().call("addPickView", args).unwrap_or(Value::Null);
            answer
        }
    };
    let pick = Rc::new(pick);
    let fill: Rc<dyn Fn(&str)> = {
        let (weak, list, library, add, state, pick) = (Rc::downgrade(shell), list.clone(), library.to_string(), add.clone(), state.clone(), pick.clone());
        Rc::new(move |q: &str| {
            let Some(s) = weak.upgrade() else { return };
            while let Some(c) = list.first_child() { list.remove(&c) }
            let rows = s.model.borrow().app.core().call("libraryOrderView", json!({ "kind": library, "query": q, "locale": "sv" })).unwrap_or(Value::Null);
            let picked = state.borrow().0.clone();
            for r in rows["rows"].as_array().into_iter().flatten() {
                let id = r["id"].as_str().unwrap_or("").to_string();
                let name = r["fileName"].as_str().or(r["name"].as_str()).unwrap_or("");
                let check = gtk::CheckButton::builder().label(name).active(picked.contains(&id)).margin_top(6).margin_bottom(6).build();
                check.set_widget_name(&format!("pick-{id}"));
                let (state, pick, add) = (state.clone(), pick.clone(), add.clone());
                check.connect_toggled(move |_| {
                    let now = pick(Some(json!({ "type": "toggle", "id": id })));
                    state.borrow_mut().0 = now["picked"].as_array().into_iter().flatten().filter_map(|v| v.as_str().map(String::from)).collect();
                    add.set_sensitive(!now["add"].is_null());
                });
                list.append(&check);
            }
        })
    };
    fill("");
    let f = fill.clone();
    search.connect_search_changed(move |e| f(&e.text()));
    let (weak, s2, f2) = (Rc::downgrade(shell), search.clone(), fill.clone());
    add.connect_clicked(move |b| {
        let Some(s) = weak.upgrade() else { return };
        let now = pick(None);
        let Some(name) = now["add"]["name"].as_str() else { return };
        let mut args = now["add"]["args"].clone();
        if let Some(n) = now["title"]["n"].as_i64() { args["title"] = json!(t(now["title"]["key"].as_str().unwrap_or(""), &[("n", &n.to_string())])) }
        let id = args["itemId"].clone();
        if added(&s, name, args) {
            *state.borrow_mut() = (vec![], id);
            b.set_sensitive(false);
            f2(&s2.text());
        }
    });
    dialog.present(Some(&shell.window));
}
