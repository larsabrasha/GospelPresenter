// A presentation's details (the Mac app's DetailsSheet, the web's PresentationDetailsDialog): Redigera detaljer, and
// Skapa presentation, blank or from a template. What the fields hold, when the confirming button may be pressed, what
// ↵ does and the change to run are the core's (`detailsStepView`); this draws GNOME's rows and does what it answers:
// the change run (and the core told how it went), the dialog closed, a presentation made opened. The theme is not
// chosen here yet, as on the Mac; its row is left out.
use crate::shell::Shell;
use adw::prelude::*;
use gp_core::view_types::{DetailsEffect, DetailsEvent, DetailsField as F, DetailsState, DetailsStep};
use gp_tui::texts::t;
use serde_json::{json, Value};
use std::cell::RefCell;
use std::rc::Rc;

fn now_ms() -> i64 { std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis() as i64) }

/// Redigera detaljer of a presentation there.
pub fn edit(shell: &Rc<Shell>, presentation_id: &str) { open(shell, json!({ "presentationId": presentation_id })) }

/// Skapa presentation: from a template (its id) prefilled, else blank with the app's word for a new one's name.
pub fn create(shell: &Rc<Shell>, template_id: Option<&str>) {
    let init = match template_id {
        Some(id) => json!({ "templateId": id, "today": gp_tui::dates::local_today(), "now": chrono_now() }),
        None => json!({ "defaultName": t("presentations.defaultName", &[]) }),
    };
    open(shell, init)
}

/// The device's time of day, `HH:MM`, for a template's next date (today only if its time has not passed).
fn chrono_now() -> String {
    let now = gtk::glib::DateTime::now_local().ok();
    now.and_then(|d| d.format("%H:%M").ok()).map(|s| s.to_string()).unwrap_or_else(|| "00:00".into())
}

/// A field's row and what it holds in the core's state.
fn value(s: &DetailsState, f: F) -> &str {
    match f { F::Name => &s.name, F::EventDate => &s.event_date, F::Time => &s.time, F::Location => &s.location, F::Description => &s.description, F::ThemeId => &s.theme_id }
}

fn title(f: F) -> String {
    t(match f { F::Name => "presentation.name", F::EventDate => "presentation.date", F::Time => "presentation.time", F::Location => "presentation.location", _ => "presentation.description" }, &[])
}

struct Dialog { shell: std::rc::Weak<Shell>, dialog: adw::Dialog, confirm: gtk::Button, rows: Vec<(F, adw::EntryRow)>, step: RefCell<Option<DetailsStep>> }

impl Dialog {
    /// An event to the core, and what it answers done; the rows and the button as the state now is.
    fn send(self: &Rc<Self>, event: DetailsEvent) {
        let (Some(shell), Some(state)) = (self.shell.upgrade(), self.step.borrow().as_ref().map(|s| s.state.clone())) else { return };
        let answer = shell.model.borrow().app.core().call("detailsStepView", json!({ "state": state, "event": event, "now": now_ms() }));
        let next = match answer.map(serde_json::from_value::<DetailsStep>) {
            Ok(Ok(next)) => next,
            Ok(Err(e)) => return eprintln!("gospel-presenter: the details' step did not read: {e}"),
            Err(code) => return eprintln!("gospel-presenter: the details' step refused: {code}"),
        };
        let effects = next.effects.clone();
        *self.step.borrow_mut() = Some(next);
        self.show();
        for effect in effects {
            match effect {
                DetailsEffect::Run { command, args } => {
                    let ok = shell.model.borrow_mut().app.run(&command, args);
                    shell.refresh();
                    self.send(DetailsEvent::Done { ok });
                }
                DetailsEffect::Close => { self.dialog.close(); }
                DetailsEffect::Open { presentation_id } => { shell.leave(); shell.open(&presentation_id) }
            }
        }
    }

    /// Each row as the core keeps its field (cut to its length), and whether the confirming button may be pressed.
    fn show(&self) {
        let Some(step) = self.step.borrow().clone() else { return };
        for (f, row) in &self.rows {
            let v = value(&step.state, *f);
            if row.text() != v { row.set_text(v) }
        }
        let confirm = step.view.actions.iter().find(|a| a.role == "confirm");
        self.confirm.set_sensitive(confirm.is_some_and(|a| a.enabled));
        let text = confirm.map(|a| if step.state.saving { a.busy_text.clone().unwrap_or_else(|| a.text.clone()) } else { a.text.clone() });
        self.confirm.set_label(&t(&text.unwrap_or_default(), &[]));
    }
}

fn open(shell: &Rc<Shell>, init: Value) {
    let first = shell.model.borrow().app.core().call("detailsStepView", json!({ "init": init }));
    let Some(step) = first.ok().and_then(|v| serde_json::from_value::<DetailsStep>(v).ok()) else { return };
    let page = adw::PreferencesPage::new();
    let mut rows = vec![];
    // The core's groups in its order, the theme left out.
    for group in &step.view.groups {
        let g = adw::PreferencesGroup::new();
        for f in group.iter().filter(|f| **f != F::ThemeId) {
            let row = adw::EntryRow::builder().title(title(*f)).build();
            g.add(&row);
            rows.push((*f, row));
        }
        if g.first_child().is_some() { page.add(&g) }
    }
    let confirm = gtk::Button::builder().css_classes(["suggested-action"]).build();
    let header = adw::HeaderBar::new();
    header.pack_end(&confirm);
    let view = adw::ToolbarView::new();
    view.add_top_bar(&header);
    view.set_content(Some(&page));
    let dialog = adw::Dialog::builder().title(t(&step.view.title, &[])).content_width(480).content_height(520).child(&view).build();
    let d = Rc::new(Dialog { shell: Rc::downgrade(shell), dialog: dialog.clone(), confirm: confirm.clone(), rows, step: RefCell::new(Some(step)) });
    d.show();
    for (f, row) in &d.rows {
        let (me, f) = (Rc::downgrade(&d), *f);
        row.connect_changed(move |r| if let Some(me) = me.upgrade() {
            let same = me.step.borrow().as_ref().is_some_and(|s| value(&s.state, f) == r.text().as_str());
            if !same { me.send(DetailsEvent::Set { field: f, value: r.text().to_string() }) }
        });
        let me = Rc::downgrade(&d);
        row.connect_entry_activated(move |_| if let Some(me) = me.upgrade() {
            me.send(DetailsEvent::Enter { field: f, id: Some(gtk::glib::uuid_string_random().to_string()) })
        });
    }
    let me = Rc::downgrade(&d);
    confirm.connect_clicked(move |_| if let Some(me) = me.upgrade() { me.send(DetailsEvent::Save { id: Some(gtk::glib::uuid_string_random().to_string()) }) });
    // The rows and the button hold the dialog weakly: it lives until it is closed.
    let kept = RefCell::new(Some(d));
    dialog.connect_closed(move |_| { kept.borrow_mut().take(); });
    dialog.present(Some(&shell.window));
}
