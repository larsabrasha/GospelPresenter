// "Anslut tillfällig skärm" (the Mac app's PairScreen.swift, the web's PairScreenDialog): the QR code a TV scans, the
// display page's address, and the four digits a TV shows typed instead. The token's making, renewing and letting go,
// the asking, the claim and a wrong code are the core's (`pairScreenStepView`), the QR code's modules too (`qrView`);
// this draws them, does the requests on a thread as the signed-in device and the timers, and switches a screen paired
// on through the live socket.
use crate::shell::Shell;
use adw::prelude::*;
use gp_core::view_types::{LiveEvent, PairEffect, PairEvent, PairStep, QrCode};
use gp_tui::texts::t;
use serde_json::{json, Value};
use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::{Rc, Weak};

struct Pair {
    shell: Weak<Shell>,
    step: RefCell<Option<PairStep>>,
    timers: RefCell<HashMap<String, gtk::glib::SourceId>>,
    qr: gtk::DrawingArea,
    address: gtk::Label,
    code: adw::EntryRow,
    wrong: gtk::Label,
    stack: gtk::Stack,
    done: gtk::Label,
}

impl Pair {
    fn send(self: &Rc<Self>, event: PairEvent) {
        let (Some(shell), Some(state)) = (self.shell.upgrade(), self.step.borrow().as_ref().map(|s| s.state.clone())) else { return };
        let answer = shell.model.borrow().app.core().call("pairScreenStepView", json!({ "state": state, "event": event }));
        let Some(next) = answer.ok().and_then(|v| serde_json::from_value::<PairStep>(v).ok()) else { return };
        let effects = next.effects.clone();
        let wrong_before = self.step.borrow().as_ref().map_or(0, |s| s.state.wrong);
        *self.step.borrow_mut() = Some(next);
        self.show(wrong_before);
        for effect in effects {
            match effect {
                PairEffect::Request { request, token, method, path, body } => {
                    let Some((server, session)) = shell.sync.borrow().as_ref().map(|s| s.server_and_session()) else { continue };
                    let me = Rc::downgrade(self);
                    crate::sync::in_background(move || {
                        let text = body.map(|b| b.to_string());
                        match server.request(&method, &path, text.as_deref(), Some(&session)) {
                            Ok((_, body)) => serde_json::from_str::<Value>(&body).unwrap_or(Value::Null),
                            Err(_) => json!({ "error": "offline" }),
                        }
                    }, move |_, body| if let Some(me) = me.upgrade() { me.send(PairEvent::Answer { request, token, body }) });
                }
                PairEffect::Timer { name, ms } => {
                    let me = Rc::downgrade(self);
                    let fired = name.clone();
                    let id = gtk::glib::timeout_add_local_once(std::time::Duration::from_millis(ms.max(0) as u64), move || {
                        if let Some(me) = me.upgrade() { me.timers.borrow_mut().remove(&fired); me.send(PairEvent::Timer { name: fired }) }
                    });
                    if let Some(old) = self.timers.borrow_mut().insert(name, id) { old.remove() }
                }
                PairEffect::CancelTimers => for (_, id) in self.timers.borrow_mut().drain() { id.remove() },
                PairEffect::Output { id } => crate::live::step(&shell, LiveEvent::Output { id, on: true, take: false }),
            }
        }
    }

    /// The QR code, the address, a wrong code said (the boxes emptied), or the screen paired.
    fn show(&self, wrong_before: i64) {
        let Some(step) = self.step.borrow().clone() else { return };
        self.qr.queue_draw();
        self.address.set_label(&step.address);
        if step.state.wrong > wrong_before { self.code.set_text("") }
        self.wrong.set_visible(step.state.wrong > 0);
        if let Some(screen) = &step.state.paired {
            self.done.set_label(&t("screens.temporary", &[("n", &screen.n.to_string())]));
            self.stack.set_visible_child_name("done");
        }
    }
}

/// The dialog, over the presentation, for this device's live session.
pub fn open(shell: &Rc<Shell>) {
    let Some(session_id) = crate::live::with(|l| l.state.session_id.clone()) else { return };
    let base = shell.sync.borrow().as_ref().map(|s| s.session.server.clone()).unwrap_or_default();
    let first = shell.model.borrow().app.core().call("pairScreenStepView", json!({ "init": { "sessionId": session_id, "base": base } }));
    let Some(step) = first.ok().and_then(|v| serde_json::from_value::<PairStep>(v).ok()) else { return };
    let qr = gtk::DrawingArea::builder().content_width(200).content_height(200).halign(gtk::Align::Center).build();
    let address = gtk::Label::builder().selectable(true).css_classes(["monospace"]).wrap(true).build();
    let code = adw::EntryRow::builder().title(t("pairScreen.code", &[])).input_purpose(gtk::InputPurpose::Digits).build();
    let wrong = gtk::Label::builder().label(t("pairScreen.wrong", &[])).css_classes(["error"]).visible(false).xalign(0.0).build();
    let asking = gtk::Box::builder().orientation(gtk::Orientation::Vertical).spacing(12).margin_start(18).margin_end(18).margin_bottom(18).build();
    asking.append(&qr);
    asking.append(&gtk::Label::builder().label(t("pairScreen.scanHint", &[])).wrap(true).css_classes(["dim-label"]).build());
    let group = adw::PreferencesGroup::builder().title(t("pairScreen.step2", &[])).build();
    let row = adw::ActionRow::builder().title(t("pairScreen.step1", &[])).build();
    row.add_suffix(&address);
    group.add(&row);
    group.add(&code);
    asking.append(&group);
    asking.append(&wrong);
    let done = gtk::Label::new(None);
    let paired = adw::StatusPage::builder().icon_name("object-select-symbolic").title(t("pairScreen.done", &[])).description(t("pairScreen.doneText", &[])).child(&done).build();
    let stack = gtk::Stack::new();
    stack.add_named(&asking, Some("asking"));
    stack.add_named(&paired, Some("done"));
    let view = adw::ToolbarView::new();
    view.add_top_bar(&adw::HeaderBar::new());
    view.set_content(Some(&stack));
    let dialog = adw::Dialog::builder().title(t("pairScreen.title", &[])).content_width(440).content_height(560).child(&view).build();
    let p = Rc::new(Pair { shell: Rc::downgrade(shell), step: RefCell::new(Some(step)), timers: RefCell::new(HashMap::new()), qr: qr.clone(), address, code: code.clone(), wrong, stack, done });
    let me = Rc::downgrade(&p);
    qr.set_draw_func(move |_, cr, w, h| {
        let Some(me) = me.upgrade() else { return };
        let link = me.step.borrow().as_ref().and_then(|s| s.link.clone());
        cr.set_source_rgb(1.0, 1.0, 1.0);
        cr.rectangle(0.0, 0.0, w.into(), h.into());
        let _ = cr.fill();
        let Some(shell) = me.shell.upgrade() else { return };
        let Some(code) = link.and_then(|l| shell.model.borrow().app.core().call("qrView", json!({ "value": l })).ok()).and_then(|v| serde_json::from_value::<QrCode>(v).ok()) else { return };
        let unit = f64::from(w.min(h)) / code.size as f64;
        cr.set_source_rgb(0.0, 0.0, 0.0);
        for (y, row) in code.rows.iter().enumerate() {
            for (x, c) in row.chars().enumerate() { if c == '1' { cr.rectangle(x as f64 * unit, y as f64 * unit, unit, unit) } }
        }
        let _ = cr.fill();
    });
    let me = Rc::downgrade(&p);
    code.connect_changed(move |e| {
        let digits: String = e.text().chars().filter(char::is_ascii_digit).take(4).collect();
        if digits != e.text().as_str() { e.set_text(&digits); return }
        if digits.len() == 4 { if let Some(me) = me.upgrade() { me.send(PairEvent::Submit { pin: digits }) } }
    });
    // The dialog lives until it is closed, and closing lets its token go.
    let kept = RefCell::new(Some(p.clone()));
    dialog.connect_closed(move |_| if let Some(p) = kept.borrow_mut().take() { p.send(PairEvent::Close) });
    dialog.present(Some(&shell.window));
    p.send(PairEvent::Open);
}
