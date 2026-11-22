// An item's menu, the same on its row in the running order (a right click or a long press, as GNOME's lists) and on
// its heading's ⋯ (the web's ItemContextMenu.tsx, the Mac app's ItemMenus.swift). What it offers, in which groups and
// which can be chosen, is the core's (`itemActionsView`); this draws it as GNOME's popover menu, a group a section.
// Not here yet, so left out: Redigera and Redigera bilder (their pages), Lägg till efter (adding).
use crate::shell::Shell;
use adw::prelude::*;
use gtk::gio;
use gp_tui::texts::t;
use serde_json::{json, Value};
use std::rc::Rc;

/// The entries this app draws; the core's others wait for their pages.
const DRAWN: [&str; 6] = ["rename", "note", "arrangement", "overlay", "tick", "delete"];

/// The menu of `item_id`, popped up over `anchor`: GTK's own popover menu, each entry an action of a group of its own
/// on the anchor (`item.*`), disabled as the core says; Arrangemang › and Överlägg › submenus of radio entries.
pub fn pop_up(shell: &Rc<Shell>, item_id: &str, anchor: &impl IsA<gtk::Widget>) {
    let groups = shell.model.borrow_mut().item_actions(item_id);
    let menu = gio::Menu::new();
    let actions = gio::SimpleActionGroup::new();
    for group in &groups {
        let section = gio::Menu::new();
        for a in group["actions"].as_array().into_iter().flatten() {
            let id = a["id"].as_str().unwrap_or("");
            if !DRAWN.contains(&id) { continue }
            let text = t(a["text"].as_str().unwrap_or(""), &[]);
            match id {
                "arrangement" | "overlay" => {
                    section.append_submenu(Some(&text), &choices(a, id));
                    actions.add_action(&choice_action(shell, item_id, a, id));
                }
                _ => {
                    section.append(Some(&text), Some(&format!("item.{id}")));
                    let action = gio::SimpleAction::new(id, None);
                    action.set_enabled(a["enabled"].as_bool().unwrap_or(true));
                    let (weak, item, id) = (Rc::downgrade(shell), item_id.to_string(), id.to_string());
                    action.connect_activate(move |_, _| if let Some(s) = weak.upgrade() { chosen(&s, &item, &id) });
                    actions.add_action(&action);
                }
            }
        }
        if section.n_items() > 0 { menu.append_section(None, &section) }
    }
    let anchor = anchor.as_ref();
    anchor.insert_action_group("item", Some(&actions));
    let popover = gtk::PopoverMenu::from_model(Some(&menu));
    popover.set_parent(anchor);
    popover.connect_closed(|p| { let p = p.clone(); gtk::glib::idle_add_local_once(move || p.unparent()); });
    popover.popup();
}

/// An entry chosen.
fn chosen(shell: &Rc<Shell>, item_id: &str, id: &str) {
    match id {
        "rename" => ask_text(shell, &t("header.rename", &[]), item_id, "title", "renameItem", "title"),
        "note" => ask_text(shell, &t("note.title", &[]), item_id, "note", "setItemNote", "note"),
        "tick" => shell.start_ticking(item_id),
        "delete" => ask_remove(shell, item_id),
        _ => {}
    }
}

/// Arrangemang › or Överlägg ›'s choices: a radio entry each, the item's own chosen. A name of its own; Original and
/// Ingen by their texts' keys; an arrangement without a name by its place.
fn choices(a: &Value, id: &str) -> gio::Menu {
    let menu = gio::Menu::new();
    for c in a["choices"].as_array().into_iter().flatten() {
        let name = c["name"].as_str().map(String::from).or_else(|| c["text"].as_str().map(|k| t(k, &[])))
            .unwrap_or_else(|| format!("{} {}", t("song.arrangement", &[]), c["n"].as_i64().unwrap_or(0)));
        let item = gio::MenuItem::new(Some(&name), None);
        item.set_action_and_target_value(Some(&format!("item.{id}")), Some(&c["id"].as_str().unwrap_or("").to_variant()));
        menu.append_item(&item);
    }
    menu
}

/// The radio action of a submenu: its state the item's choice (the empty id for Ingen), a choice saved.
fn choice_action(shell: &Rc<Shell>, item_id: &str, a: &Value, id: &str) -> gio::SimpleAction {
    let now = a["chosen"].as_str().unwrap_or("").to_string();
    let action = gio::SimpleAction::new_stateful(id, Some(gtk::glib::VariantTy::STRING), &now.to_variant());
    let (weak, item, overlay) = (Rc::downgrade(shell), item_id.to_string(), id == "overlay");
    action.connect_activate(move |action, target| {
        let Some(to) = target.and_then(|v| v.str().map(String::from)) else { return };
        action.set_state(&to.to_variant());
        let Some(s) = weak.upgrade() else { return };
        let to = if to.is_empty() { Value::Null } else { json!(to) };
        if overlay { s.run("setItemOverlay", json!({ "itemId": item, "overlayId": to })) }
        else { s.run("setItemArrangement", json!({ "itemId": item, "arrangementId": to })) }
    });
    action
}

/// Byt namn or Kommentar: the item's field in a question of its own, saved by `command` with `arg`.
fn ask_text(shell: &Rc<Shell>, title: &str, item_id: &str, field: &str, command: &str, arg: &str) {
    let now = shell.model.borrow_mut().item_field(item_id, field);
    let dialog = adw::AlertDialog::new(Some(title), None);
    let entry = gtk::Entry::builder().text(&now).activates_default(true).build();
    dialog.set_extra_child(Some(&entry));
    dialog.add_responses(&[("cancel", &t("common.cancel", &[])), ("save", &t("common.save", &[]))]);
    dialog.set_response_appearance("save", adw::ResponseAppearance::Suggested);
    dialog.set_default_response(Some("save"));
    dialog.set_close_response("cancel");
    let (weak, item, command, arg) = (Rc::downgrade(shell), item_id.to_string(), command.to_string(), arg.to_string());
    dialog.connect_response(None, move |_, response| {
        if response != "save" { return }
        let Some(s) = weak.upgrade() else { return };
        let mut args = json!({ "itemId": item });
        args[arg.as_str()] = json!(entry.text().to_string());
        s.run(&command, args);
    });
    dialog.present(Some(&shell.window));
}

/// Radera, asked first (`presentation.removeConfirm`).
fn ask_remove(shell: &Rc<Shell>, item_id: &str) {
    let title = shell.model.borrow_mut().item_field(item_id, "title");
    let dialog = adw::AlertDialog::new(Some(&t("common.delete", &[])), Some(&t("presentation.removeConfirm", &[("title", &title)])));
    dialog.add_responses(&[("cancel", &t("common.cancel", &[])), ("delete", &t("common.delete", &[]))]);
    dialog.set_response_appearance("delete", adw::ResponseAppearance::Destructive);
    dialog.set_close_response("cancel");
    let (weak, item) = (Rc::downgrade(shell), item_id.to_string());
    dialog.connect_response(None, move |_, response| {
        if response != "delete" { return }
        if let Some(s) = weak.upgrade() { s.run("removeItem", json!({ "itemId": item })) }
    });
    dialog.present(Some(&shell.window));
}
