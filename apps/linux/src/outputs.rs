// Utgångar in the live column while presenting (spec 04 §1; the Mac app's Outputs.swift, the web's OutputsPanel.tsx):
// the saved screens and the public outputs, each switched on or off for this session, a screen with no page open
// offline and not switchable (LIVE-A21), one another presentation sends to taken over only after a question
// (LIVE-R23); and "Tillåt fjärrstyrning" (LIVE-R39). Each row, the line under it and the question are the core's
// (`outputRowsView`); the session is the live socket's (live.rs). Only while signed in to a host.
use crate::shell::Shell;
use adw::prelude::*;
use gp_tui::texts::{language, t};
use serde_json::{json, Value};
use std::rc::Rc;

/// `into` made again from the live socket's state: the rows, then the remote switch; empty in the demo.
pub fn fill(shell: &Rc<Shell>, into: &gtk::Box) {
    while let Some(c) = into.first_child() { into.remove(&c) }
    let Some((sessions, online, chosen, me, remote)) = crate::live::with(|l| (l.list("sessions"), l.list("online"), l.list("chosen"), l.session_id().to_string(), l.remote())) else { return };
    let rows = {
        let m = shell.model.borrow();
        let core = m.app.core();
        let displays = core.call("displaysView", json!({ "locale": language() })).unwrap_or(json!([]));
        core.call("outputRowsView", json!({ "displays": displays, "sessions": sessions, "online": online, "chosen": chosen, "sessionId": me }))
            .map(|v| v["rows"].as_array().cloned().unwrap_or_default()).unwrap_or_default()
    };
    let group = adw::PreferencesGroup::builder().title(t("live.outputs", &[])).description(t("live.remoteHint", &[])).build();
    for r in rows { group.add(&row(shell, &r)) }
    let allow = adw::SwitchRow::builder().title(t("remote.allow", &[])).active(remote).build();
    let weak = Rc::downgrade(shell);
    allow.connect_active_notify(move |s| if let Some(sh) = weak.upgrade() { crate::live::step(&sh, json!({ "type": "remote", "on": s.is_active() })) });
    group.add(&allow);
    into.append(&group);
}

/// An output's switch, the line under it (offline in orange while chosen, another presentation's, how many watch).
fn row(shell: &Rc<Shell>, r: &Value) -> adw::SwitchRow {
    let kind = if r["kind"] == "public" { "emblem-shared-symbolic" } else { "video-display-symbolic" };
    let row = adw::SwitchRow::builder().title(r["name"].as_str().unwrap_or("")).active(r["sending"] == true).sensitive(r["offline"] != true).use_markup(false).build();
    row.add_prefix(&gtk::Image::from_icon_name(kind));
    let line = &r["line"];
    if let Some(n) = line["viewers"].as_i64() { row.set_subtitle(&format!("{n} 👁")) }
    else if let Some(key) = line["text"].as_str() {
        let args: Vec<(String, String)> = line["args"].as_object().into_iter().flatten().map(|(k, v)| (k.clone(), v.as_str().unwrap_or("").to_string())).collect();
        let vars: Vec<(&str, &str)> = args.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect();
        row.set_subtitle(&t(key, &vars));
        if line["warn"] == true { row.add_css_class("warning") }
    }
    let (weak, id, ask) = (Rc::downgrade(shell), r["id"].as_str().unwrap_or("").to_string(), r["takeOver"].clone());
    row.connect_active_notify(move |s| {
        let Some(sh) = weak.upgrade() else { return };
        if s.is_active() && ask.is_object() { take_over(&sh, &id, &ask) }
        else { crate::live::step(&sh, json!({ "type": "output", "id": id, "on": s.is_active() })) }
    });
    row
}

/// Another presentation sends to it: asked first, then taken over; not taken, the page shows it off again.
fn take_over(shell: &Rc<Shell>, id: &str, ask: &Value) {
    let args: Vec<(String, String)> = ask["args"].as_object().into_iter().flatten().map(|(k, v)| (k.clone(), v.as_str().unwrap_or("").to_string())).collect();
    let vars: Vec<(&str, &str)> = args.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect();
    let dialog = adw::AlertDialog::new(Some(&t(ask["title"].as_str().unwrap_or(""), &[])), Some(&t(ask["text"].as_str().unwrap_or(""), &vars)));
    dialog.add_responses(&[("cancel", &t("common.cancel", &[])), ("take", &t(ask["confirm"].as_str().unwrap_or(""), &[]))]);
    dialog.set_close_response("cancel");
    let (weak, id) = (Rc::downgrade(shell), id.to_string());
    dialog.connect_response(None, move |_, answer| {
        let Some(s) = weak.upgrade() else { return };
        if answer == "take" { crate::live::step(&s, json!({ "type": "output", "id": id, "on": true, "take": true })) }
        s.refresh();
    });
    dialog.present(Some(&shell.window));
}
