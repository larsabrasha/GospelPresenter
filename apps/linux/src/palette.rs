// Ctrl+K, the search of everything (the web's CommandPalette.tsx, the Mac app's Palette.swift): one field, and under
// it the open presentation's likeliest actions, the songs (`searchSongsView`), the presentations, the coming ones first
// (`paletteView`), and Lägg till's kinds. In a presentation a song is added where + would add it, and shown while
// presenting. Not here yet: a song's page and Inställningar, which the Linux app does not have (docs/linux-app.md).
use crate::shell::Shell;
use adw::prelude::*;
use gp_tui::dates::subtitle;
use gp_tui::keys::Action;
use gp_tui::texts::t;
use serde_json::{json, Value};
use std::rc::Rc;

fn core(shell: &Rc<Shell>, view: &str, args: Value) -> Value { shell.model.borrow().app.core().call(view, args).unwrap_or(Value::Null) }

pub fn open(shell: &Rc<Shell>) {
    let search = gtk::SearchEntry::builder().placeholder_text(t("palette.placeholder", &[])).build();
    let list = gtk::Box::new(gtk::Orientation::Vertical, 12);
    let content = gtk::Box::builder().orientation(gtk::Orientation::Vertical).spacing(12).margin_start(18).margin_end(18).margin_bottom(18).build();
    content.append(&search);
    content.append(&gtk::ScrolledWindow::builder().child(&list).vexpand(true).hscrollbar_policy(gtk::PolicyType::Never).build());
    let view = adw::ToolbarView::new();
    view.add_top_bar(&adw::HeaderBar::new());
    view.set_content(Some(&content));
    let dialog = adw::Dialog::builder().title(t("palette.title", &[])).content_width(560).content_height(560).child(&view).build();
    let fill = {
        let (weak, list, d) = (Rc::downgrade(shell), list.clone(), dialog.clone());
        move |q: &str| if let Some(s) = weak.upgrade() { fill(&s, &d, &list, q) }
    };
    fill("");
    search.connect_search_changed(move |e| fill(&e.text()));
    dialog.present(Some(&shell.window));
    search.grab_focus();
}

/// A group of rows under its title.
fn group(list: &gtk::Box, title: &str, rows: Vec<adw::ActionRow>) {
    if rows.is_empty() { return }
    let g = adw::PreferencesGroup::builder().title(title).build();
    for r in rows { g.add(&r) }
    list.append(&g);
}

/// A row that closes the search and does `run`.
fn row(shell: &Rc<Shell>, d: &adw::Dialog, title: &str, sub: &str, run: impl Fn(&Rc<Shell>) + 'static) -> adw::ActionRow {
    let r = adw::ActionRow::builder().title(title).subtitle(sub).activatable(true).use_markup(false).build();
    let (weak, d) = (Rc::downgrade(shell), d.clone());
    r.connect_activated(move |_| { d.close(); if let Some(s) = weak.upgrade() { run(&s) } });
    r
}

fn fill(shell: &Rc<Shell>, d: &adw::Dialog, list: &gtk::Box, query: &str) {
    while let Some(c) = list.first_child() { list.remove(&c) }
    let q = query.trim().to_lowercase();
    let (open, live, black, today) = {
        let m = shell.model.borrow();
        (m.app.open_id().map(String::from), m.app.is_live(), m.app.live.black, m.app.today.clone())
    };
    let named = |text: &str| q.is_empty() || text.to_lowercase().contains(&q);
    // The open presentation's likeliest: Starta, or Släck and Avsluta; then + 's kinds by their words.
    let mut actions = vec![];
    if open.is_some() {
        if live {
            if !black { actions.push(row(shell, d, &t("live.clear", &[]), "", |s| s.act(Action::Event(json!({ "type": "black" }))))) }
            actions.push(row(shell, d, &t("live.end", &[]), "", |s| s.act(Action::Event(json!({ "type": "end" })))));
        } else {
            actions.push(row(shell, d, &t("presentation.start", &[]), "", |s| s.act(Action::Event(json!({ "type": "start" })))));
        }
        for (id, text) in crate::adding::kinds(shell) {
            let label = t("palette.addKind", &[("kind", &t(&text, &[]).to_lowercase())]);
            if !q.is_empty() && named(&label) { actions.push(row(shell, d, &label, "", move |s| crate::adding::choose(s, &id, None))) }
        }
    }
    let actions: Vec<adw::ActionRow> = actions.into_iter().filter(|r| q.is_empty() || named(&r.title())).collect();
    group(list, &t(if q.is_empty() { "palette.suggested" } else { "palette.commands" }, &[]), actions);
    // The songs, in a presentation added where + adds them.
    if !q.is_empty() {
        let mut songs = vec![];
        for s in core(shell, "searchSongsView", json!({ "query": query, "locale": "sv" })).as_array().into_iter().flatten().take(5) {
            let (id, name) = (s["id"].as_str().unwrap_or("").to_string(), s["name"].as_str().unwrap_or("").to_string());
            let sub = if open.is_some() { t(if live { "palette.addShow" } else { "palette.add" }, &[]) } else { String::new() };
            let r = row(shell, d, &name, &sub, move |s| add_song(s, &id, live));
            r.set_activatable(open.is_some());
            songs.push(r);
        }
        group(list, &t("palette.songs", &[]), songs);
    }
    // The presentations found, the coming first (the core's), their dates as the start page writes them.
    let rows: Vec<Value> = shell.model.borrow().app.rows().iter().map(|p| json!({ "id": p.id, "label": subtitle(p, &today, true, true) })).collect();
    let labels: serde_json::Map<String, Value> = rows.iter().map(|r| (r["id"].as_str().unwrap_or("").to_string(), r["label"].clone())).collect();
    let found = core(shell, "paletteView", json!({ "query": query, "today": today, "labels": labels }));
    let mut presentations = vec![];
    for p in found["presentations"].as_array().into_iter().flatten() {
        let id = p["id"].as_str().unwrap_or("").to_string();
        let sub = labels.get(&id).and_then(Value::as_str).unwrap_or("").to_string();
        presentations.push(row(shell, d, p["name"].as_str().unwrap_or(""), &sub, move |s| { s.leave(); s.open(&id) }));
    }
    group(list, &t("palette.presentations", &[]), presentations);
    if list.first_child().is_none() {
        list.append(&adw::StatusPage::builder().icon_name("system-search-symbolic").description(t("palette.none", &[])).build());
    }
}

/// A song added where + would add it; while presenting, shown at once.
fn add_song(shell: &Rc<Shell>, song: &str, live: bool) {
    let id = gtk::glib::uuid_string_random().to_string();
    let pid = shell.model.borrow().app.open_id().unwrap_or_default().to_string();
    let after = crate::adding::after(shell, None);
    let args = json!({ "itemId": id, "presentationId": pid, "songId": song, "arrangementId": null, "afterItemId": after });
    if crate::adding::added(shell, "addSongToPresentation", args) && live {
        shell.act(Action::Event(json!({ "type": "show", "itemId": id, "partIndex": 0 })));
    }
}
