// Redigera bilder, an image item's own pictures (the web's ItemParts.tsx ImageItemEditor, the Mac app's
// ItemEditing.swift): one under the other, each moved up or down (GNOME's lists move rows by buttons more than by a
// drag) and removed after a question. A picture's place is its slide's key (`image{n}`), its place in the item's own
// list: a picture whose file is gone is not shown, so the place among those shown may be another. Adding more pictures
// waits for adding (docs/native-parity.md, round 5).
use crate::shell::Shell;
use crate::tiles;
use adw::prelude::*;
use gp_tui::texts::t;
use gp_tui::views::SlideAt;
use serde_json::json;
use std::rc::Rc;

/// A picture's place in the item's own list, from its slide's key.
fn place(key: &str) -> Option<i64> { key.strip_prefix("image")?.parse().ok() }

/// The pictures of `item_id` in a dialog of their own over the window.
pub fn open(shell: &Rc<Shell>, item_id: &str) {
    let dialog = adw::Dialog::builder().content_width(520).content_height(640).build();
    let header = adw::HeaderBar::new();
    let view = adw::ToolbarView::new();
    view.add_top_bar(&header);
    let list = gtk::Box::new(gtk::Orientation::Vertical, 12);
    list.set_margin_start(18);
    list.set_margin_end(18);
    list.set_margin_bottom(18);
    view.set_content(Some(&gtk::ScrolledWindow::builder().child(&list).vexpand(true).build()));
    dialog.set_child(Some(&view));
    fill(shell, &dialog, &list, item_id);
    dialog.present(Some(&shell.window));
}

/// The item's pictures as the page now has them, in `list`; drawn again after each change.
fn fill(shell: &Rc<Shell>, dialog: &adw::Dialog, list: &gtk::Box, item_id: &str) {
    while let Some(child) = list.first_child() { list.remove(&child) }
    let (pid, title, keys) = {
        let m = shell.model.borrow();
        let Some(page) = m.app.page.as_ref() else { return };
        let pid = page.presentation.as_ref().map(|p| p.id.clone()).unwrap_or_default();
        let title = page.item(item_id).map(|i| i.title.clone()).unwrap_or_default();
        (pid, title, page.slides_of(item_id).iter().map(|s| s.key.clone()).collect::<Vec<_>>())
    };
    dialog.set_title(&title);
    for (n, key) in keys.iter().enumerate() {
        let row = gtk::Box::new(gtk::Orientation::Horizontal, 12);
        let tile = tiles::tile(shell, &pid, SlideAt { item_id: item_id.to_string(), part_index: n as i64 }, n + 1);
        tile.set_hexpand(true);
        row.append(&tile);
        let buttons = gtk::Box::builder().orientation(gtk::Orientation::Vertical).spacing(6).valign(gtk::Align::Center).build();
        let up = gtk::Button::builder().icon_name("go-up-symbolic").tooltip_text(t("common.moveUp", &[])).sensitive(n > 0).css_classes(["flat", "circular"]).build();
        let down = gtk::Button::builder().icon_name("go-down-symbolic").tooltip_text(t("common.moveDown", &[])).sensitive(n + 1 < keys.len()).css_classes(["flat", "circular"]).build();
        let remove = gtk::Button::builder().icon_name("window-close-symbolic").tooltip_text(t("presentation.removeImage", &[("n", &(n + 1).to_string())]))
            .css_classes(["destructive-action", "circular"]).build();
        for (button, to) in [(&up, n.checked_sub(1)), (&down, (n + 1 < keys.len()).then_some(n + 1))] {
            let (weak, d, l, item, from, to) = (Rc::downgrade(shell), dialog.clone(), list.clone(), item_id.to_string(), place(key), to.and_then(|to| place(&keys[to])));
            button.connect_clicked(move |_| {
                let (Some(s), Some(from), Some(to)) = (weak.upgrade(), from, to) else { return };
                s.run("moveItemImage", json!({ "itemId": item, "from": from, "to": to }));
                fill(&s, &d, &l, &item);
            });
        }
        let (weak, d, l, item, at) = (Rc::downgrade(shell), dialog.clone(), list.clone(), item_id.to_string(), place(key));
        remove.connect_clicked(move |_| {
            let (Some(s), Some(at)) = (weak.upgrade(), at) else { return };
            ask_remove(&s, &d, &l, &item, at);
        });
        buttons.append(&up);
        buttons.append(&down);
        buttons.append(&remove);
        row.append(&buttons);
        list.append(&row);
    }
}

/// A picture removed, asked first (`presentation.removeImageConfirm`).
fn ask_remove(shell: &Rc<Shell>, dialog: &adw::Dialog, list: &gtk::Box, item_id: &str, at: i64) {
    let ask = adw::AlertDialog::new(Some(&t("common.delete", &[])), Some(&t("presentation.removeImageConfirm", &[])));
    ask.add_responses(&[("cancel", &t("common.cancel", &[])), ("delete", &t("common.delete", &[]))]);
    ask.set_response_appearance("delete", adw::ResponseAppearance::Destructive);
    ask.set_close_response("cancel");
    let (weak, d, l, item) = (Rc::downgrade(shell), dialog.clone(), list.clone(), item_id.to_string());
    ask.connect_response(None, move |_, response| {
        if response != "delete" { return }
        let Some(s) = weak.upgrade() else { return };
        s.run("removeItemImage", json!({ "itemId": item, "index": at }));
        fill(&s, &d, &l, &item);
    });
    ask.present(Some(dialog));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_pictures_place_is_read_from_its_slides_key() {
        // Arrange, Act
        let at = place("image3");

        // Assert
        assert_eq!(at, Some(3));
    }

    #[test]
    fn a_key_of_another_kind_has_no_place() {
        // Arrange, Act
        let at = place("part0");

        // Assert
        assert_eq!(at, None);
    }
}
