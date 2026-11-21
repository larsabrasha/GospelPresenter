// What each of Inställningar's lists can do, worked out once for every shell (Lars, 2026-11-21; docs/native-apps.md,
// "Each platform's own patterns"): the web's ui/Library.tsx and its pages (Songs.tsx, Bibles.tsx, Images.tsx,
// Audios.tsx, Videos.tsx, CustomSlides.tsx, Overlays.tsx), Labels.tsx, Themes.tsx, Trash.tsx, Users.tsx, Devices.tsx
// and Orgs.tsx. How a platform does it (a double click or a tap, Välj or ⌘-click, where + floats) is the shell's.
use crate::args::*;
use crate::mutators::can;
use serde_json::{json, Value};

/// An action: its id, which the shell maps to what it does and its icon; its text's key; whether it removes
/// (`destructive`, drawn in red and asked first); and, for a row's, the row's field it needs (`when`: the action is
/// offered only for a row where that field is set, as Ersätt for a deck's pages).
fn action(id: &str, text: &str, destructive: bool) -> Value { json!({ "id": id, "text": text, "destructive": destructive, "when": null }) }
fn when(id: &str, text: &str, field: &str) -> Value { json!({ "id": id, "text": text, "destructive": false, "when": field }) }

fn rename() -> Value { action("rename", "library.rename", false) }
fn download() -> Value { action("download", "library.download", false) }
/// Radera on a row: one word for every library, as the web's (`images.remove`).
fn remove() -> Value { action("delete", "images.remove", true) }
fn delete_picked() -> Value { action("delete", "common.delete", true) }

/// The page's + (`new` makes one, `import` picks files) and a second action beside it.
fn add(id: &str, text: &str) -> Value { json!({ "id": id, "text": text }) }
fn extra(text: &str, title: &str) -> Value { json!({ "id": "import", "text": text, "title": title }) }

/// `libraryPageView` {kind, role, host?}: what the list of `kind` can do for `role`:
/// - `list`: a `collection` (rows picked and acted on, one opened) or `pages` (a row leads to its page, none picked);
/// - `opens`: what a row opens, a `page`, a `preview` (a picture, a sound or a film looked at), a `sheet`, or `none`;
/// - `add` and `extra`: the page's + and the action beside it (Importera), or null;
/// - `pick`: whether rows may be picked, and `pickOnly` which (`own`: an own theme, never a built-in one);
/// - `picked`: the actions for the rows picked, in order; `row`: a row's menu, in order (a theme's are
///   `themesPageView`'s own, as they differ by theme).
/// A shell does these as its platform does (docs/native-apps.md); one it has not built is left out where it draws them.
pub fn library_page(a: &Obj) -> R<Value> {
    let kind = a.get("kind").and_then(Value::as_str).ok_or("invalid-args")?;
    let role = a.get("role").and_then(Value::as_str).unwrap_or("");
    let host = a.get("host").and_then(Value::as_bool).unwrap_or(false);
    let manage = |p: &str| can(role, p);
    let none = Value::Null;
    let page = |list: &str, opens: &str, add: Value, extra: Value, pick: bool, picked: Vec<Value>, row: Vec<Value>| {
        json!({ "kind": kind, "list": list, "opens": opens, "add": add, "extra": extra, "pick": pick, "pickOnly": null,
                "picked": if pick { picked } else { vec![] }, "row": row })
    };
    // A file library: the files may be looked at by all, imported, picked and acted on by one who manages them.
    let files = |permission: &str, row: Vec<Value>| {
        let m = manage(permission);
        page("collection", "preview", if m { add("import", "images.import") } else { Value::Null }, Value::Null, m,
             vec![download(), delete_picked()], if m { row } else { vec![] })
    };
    Ok(match kind {
        "songs" => page("collection", "page", add("new", "songs.new"), extra("songs.import.short", "songs.import.menu"), true,
                        vec![delete_picked()], vec![rename(), remove()]),
        "bibles" => page("collection", "page", add("import", "images.import"), none, true, vec![delete_picked()], vec![remove()]),
        "images" => files("ManageImages", vec![action("edit", "images.edit", false), when("revert", "images.revert", "originalFullHash"),
                                               rename(), download(), remove()]),
        "audios" => files("ManageAudios", vec![rename(), download(), remove()]),
        "videos" => files("ManageVideos", vec![rename(), download(), remove()]),
        "customSlides" => page("collection", "page", add("new", "customSlides.new"), extra("slides.importShort", "slides.import"), true,
                               vec![delete_picked()], vec![when("replace", "slideDecks.replace", "fromDeck"), rename(), remove()]),
        "overlays" => page("collection", "page", add("new", "common.create"), none, true, vec![delete_picked()], vec![rename(), remove()]),
        "labels" => page("collection", "sheet", add("new", "common.create"), none, true, vec![delete_picked()], vec![]),
        "themes" => {
            let m = manage("ManageThemes");
            let mut p = page("collection", "page", if m { add("new", "themes.new") } else { Value::Null }, none, m, vec![delete_picked()], vec![]);
            if m { p["pickOnly"] = json!("own") }
            p
        }
        "trash" => page("collection", "none", none.clone(), none, true,
                        vec![action("restore", "common.restore", false), action("purge", "common.delete", true)],
                        vec![action("restore", "common.restore", false), action("purge", "trash.purge", true)]),
        // Ny användare on a host, which makes one; elsewhere an invitation.
        "users" => page("pages", "page", if manage("ManageUsers") { add("new", if host { "users.create" } else { "users.invite" }) } else { Value::Null },
                        none, false, vec![], vec![]),
        "devices" => page("pages", "none", add("new", "devices.pair"), none, false, vec![], vec![]),
        "orgs" => page("pages", "page", add("new", "common.create"), none, false, vec![], vec![]),
        _ => return Err("invalid-args".into()),
    })
}

#[cfg(test)]
#[path = "library_pages_tests.rs"]
mod tests;
