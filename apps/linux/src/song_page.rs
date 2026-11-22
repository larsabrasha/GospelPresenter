// A song's page, from Redigera of a song's item (the Mac app's SongEditorPage, the web's SongEditor): its name and
// credits, and each part's text, every one saved as it is typed by the core's rules (autosave.rs, `autoSaveStepView`;
// a part's text asks first when another device changes it meanwhile). The stored values are read again each second
// while it is open, so a sync shows. Not here yet: a part's label, moving and removing parts, the arrangements, the
// history, the notes and links, and the trash (docs/native-parity.md).
use crate::autosave::{field, Field, Spec};
use crate::shell::Shell;
use adw::prelude::*;
use gp_core::view_types::AutoSaveKind;
use gp_tui::texts::t;
use serde_json::{json, Value};
use std::rc::Rc;

fn page(shell: &Rc<Shell>, id: &str) -> Value {
    shell.model.borrow().app.core().call("songPageView", json!({ "id": id })).unwrap_or(Value::Null)
}

fn text(v: &Value) -> String {
    match v { Value::String(s) => s.clone(), Value::Number(n) => n.to_string(), _ => String::new() }
}

/// The song's page in a dialog over the presentation.
pub fn open(shell: &Rc<Shell>, song_id: &str) {
    let p = page(shell, song_id);
    if p["song"].is_null() { return }
    let song = &p["song"];
    let id = json!({ "id": song_id });
    let spec = |name: &'static str, kind: AutoSaveKind, max: i64| Spec { command: "updateSong", args: id.clone(), field: name, kind, max, warn_on_clash: false };
    let facts: Vec<(&'static str, Rc<Field>)> = [
        ("name", "song.name", AutoSaveKind::Required, 200), ("author", "song.author", AutoSaveKind::Text, 200),
        ("publisher", "song.publisher", AutoSaveKind::Text, 200), ("year", "song.year", AutoSaveKind::Year, 4), ("ccli", "song.ccli", AutoSaveKind::Text, 20),
    ].into_iter().map(|(name, label, kind, max)| (name, field(shell, spec(name, kind, max), &t(label, &[]), &text(&song[name]), false))).collect();
    let group = adw::PreferencesGroup::new();
    for (_, f) in &facts { group.add(&f.widget()) }
    let page_widget = adw::PreferencesPage::new();
    page_widget.add(&group);
    let parts_group = adw::PreferencesGroup::builder().title(t("song.parts", &[])).build();
    let mut parts: Vec<(String, Rc<Field>)> = vec![];
    for (i, part) in p["parts"].as_array().into_iter().flatten().enumerate() {
        let pid = part["id"].as_str().unwrap_or("").to_string();
        // Its label's text (the organisation's labels), else its place, as the web names it to a screen reader.
        let label = p["labels"].as_array().into_iter().flatten().find(|l| l["id"] == part["labelId"] && !part["labelId"].is_null())
            .and_then(|l| l["text"].as_str().map(String::from)).unwrap_or_else(|| format!("{} {}", t("song.parts", &[]), i + 1));
        let spec = Spec { command: "updateSongPart", args: json!({ "id": pid }), field: "content", kind: AutoSaveKind::Text, max: 5000, warn_on_clash: true };
        let f = field(shell, spec, &label, part["content"].as_str().unwrap_or(""), true);
        let row = gtk::Box::builder().orientation(gtk::Orientation::Vertical).spacing(6).margin_bottom(12).build();
        row.append(&gtk::Label::builder().label(&label).xalign(0.0).css_classes(["heading"]).build());
        row.append(&f.widget());
        parts_group.add(&row);
        parts.push((pid, f));
    }
    page_widget.add(&parts_group);
    let view = adw::ToolbarView::new();
    view.add_top_bar(&adw::HeaderBar::new());
    view.set_content(Some(&page_widget));
    let dialog = adw::Dialog::builder().title(song["name"].as_str().unwrap_or("")).content_width(640).content_height(720).child(&view).build();
    // The stored values each second: a write's own and a sync's shown where the user is not typing.
    let (weak, sid, d) = (Rc::downgrade(shell), song_id.to_string(), dialog.clone());
    let poll = gtk::glib::timeout_add_local(std::time::Duration::from_secs(1), move || {
        let Some(s) = weak.upgrade() else { return gtk::glib::ControlFlow::Break };
        let now = page(&s, &sid);
        for (name, f) in &facts { f.stored(&text(&now["song"][*name])) }
        for (pid, f) in &parts {
            if let Some(part) = now["parts"].as_array().into_iter().flatten().find(|p| p["id"] == json!(pid)) { f.stored(part["content"].as_str().unwrap_or("")) }
        }
        d.set_title(now["song"]["name"].as_str().unwrap_or(""));
        gtk::glib::ControlFlow::Continue
    });
    let poll = std::cell::RefCell::new(Some(poll));
    let weak = Rc::downgrade(shell);
    dialog.connect_closed(move |_| {
        if let Some(p) = poll.borrow_mut().take() { p.remove() }
        // What was changed shows on the presentation's page (an item's title follows its song's name).
        if let Some(s) = weak.upgrade() { s.pulled() }
    });
    dialog.present(Some(&shell.window));
}
