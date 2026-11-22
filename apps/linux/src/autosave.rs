// A field saved as it is typed (the Mac app's AutoSaveField.swift, the web's AutoSaveField): when it writes, what it
// does not write, what it shows while the stored value changes and the clash with another device's change are the
// core's (`autoSaveStepView`); this is a GNOME entry row or a text view telling the core of its focus, each key and
// the stored value, and doing what it answers: the change run, the half second's timer, a refused write said.
use crate::shell::Shell;
use adw::prelude::*;
use gp_core::view_types::{AutoSaveEffect, AutoSaveEvent, AutoSaveKind, AutoSaveStep};
use gp_tui::texts::t;
use serde_json::{json, Value};
use std::cell::RefCell;
use std::rc::{Rc, Weak};

/// What the field writes to and its rule.
pub struct Spec { pub command: &'static str, pub args: Value, pub field: &'static str, pub kind: AutoSaveKind, pub max: i64, pub warn_on_clash: bool }

/// The widget the user types in: one line, or several (a part's text).
enum Input { Line(adw::EntryRow), Lines(gtk::TextView) }

impl Input {
    fn text(&self) -> String {
        match self { Input::Line(e) => e.text().to_string(), Input::Lines(v) => { let b = v.buffer(); b.text(&b.start_iter(), &b.end_iter(), false).to_string() } }
    }
    fn set(&self, s: &str) {
        if self.text() == s { return }
        match self { Input::Line(e) => e.set_text(s), Input::Lines(v) => v.buffer().set_text(s) }
    }
}

pub struct Field {
    shell: Weak<Shell>,
    input: Input,
    /// Another device's text and the choice, shown while a clash waits.
    clash: gtk::Box,
    theirs: gtk::Label,
    step: RefCell<Option<AutoSaveStep>>,
    timer: RefCell<Option<gtk::glib::SourceId>>,
    /// Set while the field shows the core's text itself, so that is not taken for typing.
    showing: std::cell::Cell<bool>,
}

impl Field {
    /// The widget to place: the row, or the text view with its clash box under it.
    pub fn widget(&self) -> gtk::Widget {
        match &self.input {
            Input::Line(e) => e.clone().upcast(),
            Input::Lines(v) => {
                let b = gtk::Box::new(gtk::Orientation::Vertical, 6);
                b.append(v);
                b.append(&self.clash);
                b.upcast()
            }
        }
    }

    /// The stored value as now read (after a change, a sync): followed while the user is not typing.
    pub fn stored(self: &Rc<Self>, value: &str) { self.send(AutoSaveEvent::Stored { value: value.into() }) }

    fn send(self: &Rc<Self>, event: AutoSaveEvent) {
        let (Some(shell), Some(state)) = (self.shell.upgrade(), self.step.borrow().as_ref().map(|s| s.state.clone())) else { return };
        let answer = shell.model.borrow().app.core().call("autoSaveStepView", json!({ "state": state, "event": event }));
        let Some(next) = answer.ok().and_then(|v| serde_json::from_value::<AutoSaveStep>(v).ok()) else { return };
        let (shown, clash, effects) = (next.shown.clone(), next.clash.clone(), next.effects.clone());
        *self.step.borrow_mut() = Some(next);
        self.showing.set(true);
        self.input.set(&shown);
        self.showing.set(false);
        self.clash.set_visible(clash.is_some());
        self.theirs.set_label(clash.as_deref().unwrap_or(""));
        for effect in effects {
            match effect {
                AutoSaveEffect::Run { command, args } => {
                    let ok = shell.model.borrow_mut().app.run(&command, args);
                    self.send(AutoSaveEvent::Done { ok });
                }
                AutoSaveEffect::Timer { ms } => {
                    if let Some(old) = self.timer.borrow_mut().take() { old.remove() }
                    let me = Rc::downgrade(self);
                    let id = gtk::glib::timeout_add_local_once(std::time::Duration::from_millis(ms.max(0) as u64), move || {
                        if let Some(me) = me.upgrade() { me.timer.borrow_mut().take(); me.send(AutoSaveEvent::Timer) }
                    });
                    *self.timer.borrow_mut() = Some(id);
                }
                AutoSaveEffect::CancelTimer => if let Some(old) = self.timer.borrow_mut().take() { old.remove() },
                AutoSaveEffect::Failed => eprintln!("gospel-presenter: {}", t("common.saveFailed", &[])),
                AutoSaveEffect::Saved => {}
            }
        }
    }
}

/// A field for `spec`, its label `label`, showing `stored`; `lines` for several lines.
pub fn field(shell: &Rc<Shell>, spec: Spec, label: &str, stored: &str, lines: bool) -> Rc<Field> {
    let init = json!({ "init": { "command": spec.command, "args": spec.args, "field": spec.field, "kind": spec.kind, "max": spec.max, "warnOnClash": spec.warn_on_clash, "stored": stored } });
    let first = shell.model.borrow().app.core().call("autoSaveStepView", init).ok().and_then(|v| serde_json::from_value::<AutoSaveStep>(v).ok());
    let input = if lines {
        let v = gtk::TextView::builder().wrap_mode(gtk::WrapMode::WordChar).height_request(110).top_margin(8).bottom_margin(8).left_margin(10).right_margin(10)
            .css_classes(["card"]).build();
        v.buffer().set_text(stored);
        v.update_property(&[gtk::accessible::Property::Label(label)]);
        Input::Lines(v)
    } else {
        Input::Line(adw::EntryRow::builder().title(label).text(stored).build())
    };
    let theirs = gtk::Label::builder().wrap(true).xalign(0.0).css_classes(["dim-label"]).build();
    let clash = gtk::Box::builder().orientation(gtk::Orientation::Vertical).spacing(6).visible(false).css_classes(["card"]).build();
    clash.append(&gtk::Label::builder().label(t("autosave.clash", &[])).wrap(true).xalign(0.0).css_classes(["heading"]).build());
    clash.append(&theirs);
    let buttons = gtk::Box::new(gtk::Orientation::Horizontal, 6);
    let keep = gtk::Button::with_label(&t("autosave.keepMine", &[]));
    let take = gtk::Button::with_label(&t("autosave.takeTheirs", &[]));
    buttons.append(&keep);
    buttons.append(&take);
    clash.append(&buttons);
    let f = Rc::new(Field { shell: Rc::downgrade(shell), input, clash, theirs, step: RefCell::new(first), timer: RefCell::new(None), showing: std::cell::Cell::new(false) });
    let typed = { let me = Rc::downgrade(&f); move |text: String| if let Some(me) = me.upgrade() { if !me.showing.get() { me.send(AutoSaveEvent::Input { value: text }) } } };
    let focus = gtk::EventControllerFocus::new();
    { let me = Rc::downgrade(&f); focus.connect_enter(move |_| if let Some(me) = me.upgrade() { me.send(AutoSaveEvent::Focus) }); }
    { let me = Rc::downgrade(&f); focus.connect_leave(move |_| if let Some(me) = me.upgrade() { me.send(AutoSaveEvent::Blur) }); }
    match &f.input {
        Input::Line(e) => {
            e.add_controller(focus);
            e.connect_changed(move |e| typed(e.text().to_string()));
            let me = Rc::downgrade(&f);
            e.connect_entry_activated(move |_| if let Some(me) = me.upgrade() { me.send(AutoSaveEvent::Blur) });
        }
        Input::Lines(v) => {
            v.add_controller(focus);
            v.buffer().connect_changed(move |b| typed(b.text(&b.start_iter(), &b.end_iter(), false).to_string()));
        }
    }
    { let me = Rc::downgrade(&f); keep.connect_clicked(move |_| if let Some(me) = me.upgrade() { me.send(AutoSaveEvent::KeepMine) }); }
    { let me = Rc::downgrade(&f); take.connect_clicked(move |_| if let Some(me) = me.upgrade() { me.send(AutoSaveEvent::TakeTheirs) }); }
    f
}
