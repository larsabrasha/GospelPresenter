// Markera, the running order's select mode (the web's RunningOrder.tsx, the Mac app's Ticking.swift): an item's menu
// begins it with that item ticked, rows are ticked (⇧-click ticks a range), Markera alla, Klar ends it, and the
// ticked are removed together after a question. What is ticked and may be, and the question's texts, are the core's
// (`tickView`, Model::tick); the item on the outputs cannot be ticked. GNOME's selection mode: a check on each row.
use crate::shell::Shell;
use adw::prelude::*;
use gp_tui::texts::t;
use gp_tui::views::PresentationPage;
use serde_json::{json, Value};
use std::rc::Rc;

/// The select mode's rows in `into`, as `state` (tickView's answer) has them.
pub fn fill(shell: &Rc<Shell>, into: &gtk::Box, page: &PresentationPage, state: &Value) {
    while let Some(child) = into.first_child() { into.remove(&child) }
    let has = |k: &str, id: &str| state[k].as_array().is_some_and(|l| l.iter().any(|x| x == id));

    let bar = gtk::Box::builder().spacing(6).margin_start(12).margin_end(12).margin_top(8).margin_bottom(8).build();
    let all = gtk::CheckButton::builder().label(t("presentation.tickAll", &[])).active(state["allTicked"] == json!(true)).build();
    all.set_widget_name("tick-all");
    let weak = Rc::downgrade(shell);
    all.connect_toggled(move |_| if let Some(s) = weak.upgrade() { s.tick(json!({ "type": "all" })) });
    bar.append(&all);
    let done = gtk::Button::builder().label(t("presentation.tickDone", &[])).hexpand(true).halign(gtk::Align::End)
        .css_classes(["suggested-action"]).build();
    let weak = Rc::downgrade(shell);
    done.connect_clicked(move |_| if let Some(s) = weak.upgrade() { s.stop_ticking() });
    bar.append(&done);
    into.append(&bar);

    let list = gtk::ListBox::builder().selection_mode(gtk::SelectionMode::None).css_classes(["navigation-sidebar"]).build();
    for item in &page.items {
        let title = gtk::Label::builder().label(&item.title).xalign(0.0).ellipsize(gtk::pango::EllipsizeMode::End).build();
        let check = gtk::CheckButton::builder().child(&title).active(has("ticked", &item.id))
            .sensitive(has("tickable", &item.id)).margin_top(6).margin_bottom(6).build();
        check.set_widget_name(&format!("tick-{}", item.id));
        let (weak, id) = (Rc::downgrade(shell), item.id.clone());
        check.connect_toggled(move |c| {
            let Some(s) = weak.upgrade() else { return };
            // ⇧ held with the click: a range from the last row ticked, as the web's Shift+click.
            let range = c.display().default_seat().and_then(|seat| seat.keyboard())
                .is_some_and(|k| k.modifier_state().contains(gtk::gdk::ModifierType::SHIFT_MASK));
            s.tick(json!({ "type": "tick", "itemId": id, "range": range }));
        });
        list.append(&check);
    }
    let scroll = gtk::ScrolledWindow::builder().child(&list).vexpand(true).hscrollbar_policy(gtk::PolicyType::Never).build();
    into.append(&scroll);

    if let Some(remove) = state["remove"].as_object().cloned() {
        let n = remove["n"].as_i64().unwrap_or(0).to_string();
        let button = gtk::Button::builder().label(t("presentation.removeTicked", &[("n", &n)]))
            .css_classes(["destructive-action"]).margin_start(12).margin_end(12).margin_top(8).margin_bottom(12).build();
        button.set_widget_name("tick-remove");
        let weak = Rc::downgrade(shell);
        button.connect_clicked(move |_| if let Some(s) = weak.upgrade() { ask(&s, &remove) });
        into.append(&button);
    }
}

/// The question before the ticked are removed, in the core's words.
fn ask(shell: &Rc<Shell>, remove: &serde_json::Map<String, Value>) {
    let key = |k: &str| remove[k].as_str().unwrap_or("").to_string();
    let n = remove["n"].as_i64().unwrap_or(0).to_string();
    let dialog = adw::AlertDialog::new(Some(&t(&key("title"), &[])), Some(&t(&key("text"), &[("n", &n)])));
    dialog.add_responses(&[("cancel", &t("common.cancel", &[])), ("delete", &t(&key("confirm"), &[]))]);
    dialog.set_response_appearance("delete", adw::ResponseAppearance::Destructive);
    dialog.set_close_response("cancel");
    let weak = Rc::downgrade(shell);
    dialog.connect_response(None, move |_, response| {
        if response != "delete" { return }
        if let Some(s) = weak.upgrade() { s.remove_ticked() }
    });
    dialog.present(Some(&shell.window));
}
