// Lägg till Bibeltext (spec 05; the web's BibleTab.tsx, the Mac app's BibleSheet.swift): a translation, a reference
// searched ("Joh 3:16", `verseSearchPlanView`) or a passage browsed (`bibleBrowseView`: a book, the start's chapter
// and verse, the end's), its slides painted as the outputs will show them (`bibleSlidesView`, `slideLayoutView`), and
// added (`addBibleToPresentation`), at most the verses an item holds (`rulesView`). Read from this device's kept texts
// (`bibleView`); a translation not kept here is not offered yet (the app does not sync).
use crate::adding::{added, dialog};
use crate::painter;
use crate::shell::Shell;
use adw::prelude::*;
use gp_tui::texts::t;
use serde_json::{json, Value};
use std::cell::RefCell;
use std::rc::Rc;

struct State {
    bible: usize,
    query: String,
    browse: Value,
    after: Value,
}

fn core(shell: &Rc<Shell>, view: &str, args: Value) -> Value { shell.model.borrow().app.core().call(view, args).unwrap_or(Value::Null) }

/// The translations this device keeps the text of.
fn bibles(shell: &Rc<Shell>) -> Vec<Value> {
    core(shell, "biblesView", json!({ "locale": "sv" })).as_array().cloned().unwrap_or_default().into_iter().filter(|b| b["stored"] == json!(true)).collect()
}

fn book_name(shell: &Rc<Shell>, code: &str) -> String {
    core(shell, "bibleBookNamesView", json!({ "codes": [code] }))[0]["sv"].as_str().unwrap_or(code).to_string()
}

/// The verses chosen: a browse's passage, else a search's.
fn chosen(shell: &Rc<Shell>, hash: &str, st: &State) -> Vec<Value> {
    let passage = |ask: Value| {
        let mut ask = ask;
        ask["hash"] = json!(hash);
        core(shell, "bibleView", ask)["passage"].as_array().cloned().unwrap_or_default()
    };
    if !st.browse.is_null() { return passage(core(shell, "bibleBrowseView", json!({ "browse": st.browse }))["ask"].clone()) }
    let books = core(shell, "bibleView", json!({ "hash": hash }))["books"].clone();
    let q = st.query.trim();
    if q.is_empty() { return vec![] }
    let plan = core(shell, "verseSearchPlanView", json!({ "query": q, "available": books }));
    if plan.is_null() { return vec![] }
    passage(json!({ "passage": { "books": plan["codes"], "from": plan["from"], "to": plan["to"] } }))
}

/// The dialog's drawing, set once it is made, for the cells' clicks to draw it again.
type Redraw = Rc<RefCell<Option<Rc<dyn Fn()>>>>;

pub fn open(shell: &Rc<Shell>, after: Value) {
    let all = bibles(shell);
    let add = gtk::Button::builder().label(t("presentation.add", &[])).sensitive(false).build();
    let content = gtk::Box::builder().orientation(gtk::Orientation::Horizontal).spacing(18).margin_start(18).margin_end(18).margin_bottom(18).build();
    let dialog = dialog(&t("presentation.addKind", &[("kind", &t("add.bible", &[]).to_lowercase())]), &content, &add);
    dialog.set_content_width(960);
    if all.is_empty() {
        let none = adw::StatusPage::builder().icon_name("accessories-dictionary-symbolic").title(t("bible.none", &[])).description(t("bible.noneText", &[])).hexpand(true).build();
        content.append(&none);
        dialog.present(Some(&shell.window));
        return;
    }
    let left = gtk::Box::builder().orientation(gtk::Orientation::Vertical).spacing(12).width_request(360).hexpand(false).build();
    let names: Vec<String> = all.iter().map(|b| b["name"].as_str().unwrap_or("").to_string()).collect();
    let translation = gtk::DropDown::from_strings(&names.iter().map(String::as_str).collect::<Vec<_>>());
    let search = gtk::SearchEntry::builder().placeholder_text(t("bible.search", &[])).build();
    let prompt = gtk::Label::builder().xalign(0.0).css_classes(["accent"]).build();
    // The browse's crumbs: back to the books, and each step picked, to go back to (the web's BrowsePicker).
    let crumbs = gtk::Box::new(gtk::Orientation::Horizontal, 2);
    let cells = gtk::FlowBox::builder().selection_mode(gtk::SelectionMode::None).max_children_per_line(8).min_children_per_line(2)
        .valign(gtk::Align::Start).homogeneous(true).build();
    if all.len() > 1 { left.append(&translation) }
    left.append(&search);
    left.append(&crumbs);
    left.append(&prompt);
    left.append(&gtk::ScrolledWindow::builder().child(&cells).vexpand(true).hscrollbar_policy(gtk::PolicyType::Never).build());
    let title = gtk::Label::builder().xalign(0.0).css_classes(["title-3"]).build();
    title.set_widget_name("bible-title");
    let previews = gtk::Box::new(gtk::Orientation::Vertical, 12);
    let right = gtk::Box::builder().orientation(gtk::Orientation::Vertical).spacing(12).hexpand(true).build();
    right.append(&title);
    right.append(&gtk::ScrolledWindow::builder().child(&previews).vexpand(true).build());
    content.append(&left);
    content.append(&right);

    let st = Rc::new(RefCell::new(State { bible: 0, query: String::new(), browse: Value::Null, after }));
    let redraw: Redraw = Rc::new(RefCell::new(None));
    let draw: Rc<dyn Fn()> = {
        let (weak, st, cells, prompt, title, previews, add, all, redraw, crumbs) =
            (Rc::downgrade(shell), st.clone(), cells.clone(), prompt.clone(), title.clone(), previews.clone(), add.clone(), all.clone(), redraw.clone(), crumbs.clone());
        Rc::new(move || {
            let Some(s) = weak.upgrade() else { return };
            let (bible, browse, query) = { let x = st.borrow(); (all[x.bible].clone(), x.browse.clone(), x.query.clone()) };
            let hash = bible["contentHash"].as_str().unwrap_or("").to_string();
            while let Some(c) = cells.first_child() { cells.remove(&c) }
            while let Some(c) = crumbs.first_child() { crumbs.remove(&c) }
            let crumb = |text: &str, event: Option<Value>| {
                let b = gtk::Button::builder().css_classes(["flat"]).build();
                if text.is_empty() { b.set_icon_name("go-previous-symbolic") } else { b.set_label(text) }
                let (st, redraw, w) = (st.clone(), redraw.clone(), Rc::downgrade(&s));
                b.connect_clicked(move |_| {
                    let Some(s) = w.upgrade() else { return };
                    let now = st.borrow().browse.clone();
                    let next = match &event { Some(e) => core(&s, "bibleBrowseView", json!({ "browse": now, "event": e }))["browse"].clone(), None => Value::Null };
                    st.borrow_mut().browse = next;
                    if let Some(f) = redraw.borrow().clone() { f() }
                });
                crumbs.append(&b);
            };
            if !browse.is_null() && query.trim().is_empty() {
                crumb("", None);
                crumb(&book_name(&s, browse["book"].as_str().unwrap_or("")), Some(json!({ "type": "step", "step": "book" })));
                if let Some(c) = browse["start"][0].as_i64() { crumb(&c.to_string(), Some(json!({ "type": "step", "step": "startChapter" }))) }
                if let Some(v) = browse["start"][1].as_i64().filter(|v| *v > 0) { crumb(&format!(":{v}"), Some(json!({ "type": "step", "step": "startVerse" }))) }
                if let Some(e) = browse["end"].as_array() { crumb(&format!("– {}:{}", e[0], e[1]), Some(json!({ "type": "step", "step": "endVerse" }))) }
            }
            // The browse's cells: the books, then a step's chapters or verses, each a button sending its event.
            let cell = |text: &str, picked: bool, event: Value| {
                let b = gtk::Button::builder().label(text).build();
                if picked { b.add_css_class("suggested-action") }
                b.set_widget_name(&format!("bible-{text}"));
                let (st, redraw) = (st.clone(), redraw.clone());
                let w = Rc::downgrade(&s);
                b.connect_clicked(move |_| {
                    let Some(s) = w.upgrade() else { return };
                    let now = st.borrow().browse.clone();
                    st.borrow_mut().browse = core(&s, "bibleBrowseView", json!({ "browse": now, "event": event }))["browse"].clone();
                    if let Some(f) = redraw.borrow().clone() { f() }
                });
                cells.insert(&b, -1);
            };
            if query.trim().is_empty() {
                if browse.is_null() {
                    prompt.set_label(&t("bible.pickBook", &[]));
                    for code in core(&s, "bibleView", json!({ "hash": hash }))["books"].as_array().into_iter().flatten().filter_map(Value::as_str) {
                        cell(&book_name(&s, code), false, json!({ "type": "book", "book": code }));
                    }
                } else {
                    let now = core(&s, "bibleBrowseView", json!({ "browse": browse }));
                    prompt.set_label(&t(now["prompt"].as_str().unwrap_or(""), &[]));
                    let mut ask = now["ask"].clone();
                    ask["hash"] = json!(hash);
                    let read = core(&s, "bibleView", ask);
                    match now["browse"]["step"].as_str() {
                        Some("book") => for code in read["books"].as_array().into_iter().flatten().filter_map(Value::as_str) {
                            cell(&book_name(&s, code), false, json!({ "type": "book", "book": code }));
                        },
                        Some("startChapter") | Some("endChapter") => for c in read["chapters"].as_array().into_iter().flatten().filter_map(Value::as_i64) {
                            cell(&c.to_string(), false, json!({ "type": "chapter", "n": c }));
                        },
                        _ => for v in read["verses"].as_array().into_iter().flatten().filter_map(|v| v[1].as_i64()) {
                            let p = &now["picked"];
                            let picked = p.is_object() && v >= p["from"].as_i64().unwrap_or(0) && p["to"].as_i64().is_none_or(|to| v <= to);
                            cell(&v.to_string(), picked, json!({ "type": "verse", "n": v }));
                        },
                    }
                }
            } else {
                prompt.set_label("");
            }
            // The preview: the item's title and its first slides painted.
            while let Some(c) = previews.first_child() { previews.remove(&c) }
            let verses = chosen(&s, &hash, &st.borrow());
            let limit = core(&s, "rulesView", json!({}))["limits"]["versesPerItem"].as_u64().unwrap_or(500) as usize;
            let shown: Vec<Value> = verses.into_iter().take(limit).collect();
            add.set_sensitive(!shown.is_empty());
            if shown.is_empty() { title.set_label(""); return }
            let preview = core(&s, "bibleSlidesView", json!({ "translation": bible["abbreviation"], "verses": shown }));
            title.set_label(preview["title"].as_str().unwrap_or(""));
            for slide in preview["slides"].as_array().into_iter().flatten().take(6) {
                let layout = s.model.borrow_mut().preview_layout(slide);
                let area = gtk::DrawingArea::builder().content_width(480).content_height(270).build();
                area.set_draw_func(move |_, cr, w, h| {
                    painter::empty(cr, f64::from(w), f64::from(h));
                    if let Some(l) = &layout { painter::paint(cr, l, None, f64::from(w), f64::from(h)) }
                });
                previews.append(&area);
            }
        })
    };
    *redraw.borrow_mut() = Some(draw.clone());
    draw();
    let (st2, d2) = (st.clone(), draw.clone());
    search.connect_search_changed(move |e| { { let mut x = st2.borrow_mut(); x.query = e.text().to_string(); x.browse = Value::Null; } d2() });
    let (st3, d3) = (st.clone(), draw.clone());
    translation.connect_selected_notify(move |dd| { { let mut x = st3.borrow_mut(); x.bible = dd.selected() as usize; x.browse = Value::Null; } d3() });
    let (weak, s4) = (Rc::downgrade(shell), search.clone());
    add.connect_clicked(move |_| {
        let Some(s) = weak.upgrade() else { return };
        let bible = all[st.borrow().bible].clone();
        let verses = chosen(&s, bible["contentHash"].as_str().unwrap_or(""), &st.borrow());
        let limit = core(&s, "rulesView", json!({}))["limits"]["versesPerItem"].as_u64().unwrap_or(500) as usize;
        let verses: Vec<Value> = verses.into_iter().take(limit).collect();
        let id = gtk::glib::uuid_string_random().to_string();
        let args = json!({ "itemId": id, "presentationId": s.model.borrow().app.open_id(), "bibleId": bible["id"], "translation": bible["abbreviation"],
                           "verses": verses, "afterItemId": st.borrow().after });
        if added(&s, "addBibleToPresentation", args) {
            { let mut x = st.borrow_mut(); x.after = json!(id); x.browse = Value::Null; }
            s4.set_text("");
            draw();
        }
    });
    dialog.present(Some(&shell.window));
}
