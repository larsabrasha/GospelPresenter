// Mina inställningar (the Mac app's SettingsMine.swift), its groups and rows the core's (`mySettingsView`): the name,
// saved when it is applied or left, only when changed and not empty; the address with its Bekräftad or Obekräftad,
// Bekräfta e-post where the server mails, Byt e-postadress in a dialog; and this device's colour theme and language
// (prefs.rs). Signed in only for the profile; the demo shows it without changing it. Left out until built here:
// Superadminläge (it opens the database again with the new role), Slå på utgångar automatiskt, and the pages Lagring,
// Inloggningar and Mina felrapporter.
use crate::shell::Shell;
use adw::prelude::*;
use gp_tui::texts::t;
use serde::Deserialize;
use serde_json::{json, Value};
use std::cell::RefCell;
use std::rc::Rc;

#[derive(Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct FullMe { name: String, email: Option<String>, #[serde(default)] email_confirmed: bool }

#[derive(Deserialize)]
struct Choice { id: String, text: String }
#[derive(Deserialize)]
struct Badge { text: String, colour: String }
#[derive(Deserialize)]
struct Row { id: String, kind: String, text: String, choices: Option<Vec<Choice>>, value: Option<String>, empty: Option<String>, badge: Option<Badge> }
#[derive(Deserialize)]
struct Group { title: Option<String>, footer: Option<String>, rows: Vec<Row> }
#[derive(Deserialize)]
struct Groups { groups: Vec<Group> }

/// A request to the host as the signed-in member, on a thread: the answer's JSON, or the refusal's code (`offline` when
/// it did not reach the host).
pub fn api(shell: &Rc<Shell>, method: &str, path: &str, body: Option<Value>, then: impl FnOnce(&Rc<Shell>, Result<Value, String>) + 'static) {
    let Some((server, session)) = shell.sync.borrow().as_ref().map(|s| s.server_and_session()) else { return then(shell, Err("offline".into())) };
    let (method, path) = (method.to_string(), path.to_string());
    crate::sync::in_background(move || {
        let text = body.map(|b| b.to_string());
        match server.request(&method, &path, text.as_deref(), Some(&session)) {
            Ok((status, body)) => {
                let v: Value = serde_json::from_str(&body).unwrap_or(Value::Null);
                if (200..300).contains(&status) { Ok(v) } else { Err(v["error"].as_str().unwrap_or("offline").to_string()) }
            }
            Err(_) => Err("offline".into()),
        }
    }, then);
}

/// A refusal said, as the app's texts word the server's codes.
pub fn said(shell: &Rc<Shell>, text: &str) {
    let dialog = adw::AlertDialog::new(None, Some(text));
    dialog.add_response("close", &t("common.close", &[]));
    dialog.present(Some(&shell.window));
}

fn refusal(code: &str) -> String {
    let key = format!("error.{code}");
    let text = t(&key, &[]);
    if text == key { t("error.offline", &[]) } else { text }
}

struct Mine { shell: Rc<Shell>, page: adw::PreferencesPage, groups: RefCell<Vec<adw::PreferencesGroup>>, me: RefCell<Option<FullMe>>, mail: std::cell::Cell<bool> }

impl Mine {
    /// The groups as the core lays them out for what is known now.
    fn fill(self: &Rc<Self>) {
        for g in self.groups.borrow_mut().drain(..) { self.page.remove(&g) }
        let me = self.me.borrow().clone();
        let role = crate::settings::role(&self.shell);
        let args = json!({ "role": role, "superAdmin": false, "desktop": false, "mail": self.mail.get(),
                           "emailConfirmed": me.as_ref().is_some_and(|m| m.email_confirmed), "email": me.as_ref().and_then(|m| m.email.clone()) });
        let groups = self.shell.model.borrow().app.core().call("mySettingsView", args).ok().and_then(|v| serde_json::from_value::<Groups>(v).ok());
        for g in groups.map(|g| g.groups).unwrap_or_default() {
            let rows: Vec<gtk::Widget> = g.rows.iter().filter_map(|r| self.row(r, me.as_ref())).collect();
            if rows.is_empty() { continue }
            let group = adw::PreferencesGroup::new();
            if let Some(title) = &g.title { group.set_title(&t(title, &[])) }
            if let Some(footer) = &g.footer { group.set_description(Some(&t(footer, &[]))) }
            for r in rows { group.add(&r) }
            self.page.add(&group);
            self.groups.borrow_mut().push(group);
        }
    }

    fn row(self: &Rc<Self>, r: &Row, me: Option<&FullMe>) -> Option<gtk::Widget> {
        let signed_in = self.shell.sync.borrow().is_some();
        Some(match (r.kind.as_str(), r.id.as_str()) {
            ("field", _) => {
                let name = me.map(|m| m.name.clone()).or_else(|| self.shell.sync.borrow().as_ref().map(|s| s.session.me.name.clone())).unwrap_or_default();
                let entry = adw::EntryRow::builder().title(t(&r.text, &[])).text(&name).show_apply_button(true).sensitive(signed_in).build();
                let me = Rc::downgrade(self);
                entry.connect_apply(move |e| if let Some(m) = me.upgrade() { m.save_name(&e.text()) });
                // Left without applying: saved all the same, as the web's field saves on blur.
                let focus = gtk::EventControllerFocus::new();
                let (me, at) = (Rc::downgrade(self), entry.downgrade());
                focus.connect_leave(move |_| if let (Some(m), Some(e)) = (me.upgrade(), at.upgrade()) { m.save_name(&e.text()) });
                entry.add_controller(focus);
                entry.upcast()
            }
            ("value", _) => {
                let row = adw::ActionRow::builder().title(t(&r.text, &[])).subtitle(r.value.clone().unwrap_or_else(|| t(r.empty.as_deref().unwrap_or(""), &[]))).build();
                if let Some(b) = &r.badge {
                    row.add_suffix(&gtk::Label::builder().label(t(&b.text, &[])).css_classes([if b.colour == "green" { "success" } else { "warning" }, "caption"]).build());
                }
                row.upcast()
            }
            ("action", id) => {
                let button = adw::ButtonRow::builder().title(t(&r.text, &[])).sensitive(signed_in).build();
                let (me, id) = (Rc::downgrade(self), id.to_string());
                button.connect_activated(move |_| if let Some(m) = me.upgrade() {
                    if id == "changeEmail" { m.change_email() } else { m.confirm_email() }
                });
                button.upcast()
            }
            ("choice", id) => {
                let choices = r.choices.as_ref()?;
                let names: Vec<String> = choices.iter().map(|c| t(&c.text, &[])).collect();
                let list = gtk::StringList::new(&names.iter().map(String::as_str).collect::<Vec<_>>());
                let prefs = crate::prefs::load();
                let now = if id == "theme" { crate::prefs::theme(&prefs).to_string() } else { gp_tui::texts::language().to_string() };
                let at = choices.iter().position(|c| c.id == now).unwrap_or(0) as u32;
                let combo = adw::ComboRow::builder().title(t(&r.text, &[])).model(&list).selected(at).build();
                let ids: Vec<String> = choices.iter().map(|c| c.id.clone()).collect();
                let (shell, id) = (Rc::downgrade(&self.shell), id.to_string());
                combo.connect_selected_notify(move |c| {
                    let (Some(shell), Some(chosen)) = (shell.upgrade(), ids.get(c.selected() as usize).cloned()) else { return };
                    let mut prefs = crate::prefs::load();
                    if id == "theme" { prefs.theme = Some(chosen) } else { prefs.language = Some(chosen) }
                    crate::prefs::save(&prefs);
                    crate::prefs::apply(&prefs);
                    // Every page in the new language: the start page now, a presentation's when next opened, and
                    // Inställningar opened again over this one.
                    if id == "language" { crate::start_page::fill(&shell); relaunch(&shell, c) }
                });
                combo.upcast()
            }
            _ => return None,
        })
    }

    /// The name saved: trimmed, not empty, and only when it changed; the session's name with it.
    fn save_name(self: &Rc<Self>, typed: &str) {
        let name = typed.trim().to_string();
        let before = self.me.borrow().as_ref().map(|m| m.name.clone());
        if name.is_empty() || before.is_none() || before.as_deref() == Some(name.as_str()) { return }
        if let Some(me) = self.me.borrow_mut().as_mut() { me.name = name.clone() }
        let page = Rc::downgrade(self);
        api(&self.shell, "PATCH", "/api/auth/me", Some(json!({ "name": name })), move |shell, answer| {
            match answer {
                Ok(_) => {
                    if let Some(s) = shell.sync.borrow_mut().as_mut() {
                        s.session.me.name = name.clone();
                        crate::net::save_session(Some(&s.session));
                    }
                    crate::start_page::fill(shell);
                }
                Err(code) => {
                    if let Some(p) = page.upgrade() { if let Some(me) = p.me.borrow_mut().as_mut() { me.name = before.unwrap_or_default() } }
                    said(shell, &refusal(&code))
                }
            }
        });
    }

    fn confirm_email(self: &Rc<Self>) {
        let Some(email) = self.me.borrow().as_ref().and_then(|m| m.email.clone()) else { return };
        let body = json!({ "email": email, "language": gp_tui::texts::language() });
        api(&self.shell, "POST", "/api/auth/email", Some(body), move |shell, answer| match answer {
            Ok(_) => said(shell, &t("profile.linkSent", &[("email", &email)])),
            Err(code) => said(shell, &refusal(&code)),
        });
    }

    /// Byt e-postadress: the new address, Avbryt and Spara; a refusal said under the field.
    fn change_email(self: &Rc<Self>) {
        let entry = adw::EntryRow::builder().title(t("profile.newEmail", &[])).input_purpose(gtk::InputPurpose::Email).build();
        let error = gtk::Label::builder().css_classes(["error"]).wrap(true).xalign(0.0).visible(false).build();
        let group = adw::PreferencesGroup::builder().margin_start(18).margin_end(18).margin_top(12).margin_bottom(18).build();
        group.add(&entry);
        let body = gtk::Box::new(gtk::Orientation::Vertical, 6);
        body.append(&group);
        body.append(&error);
        let cancel = gtk::Button::with_label(&t("common.cancel", &[]));
        let save = gtk::Button::builder().label(t("common.save", &[])).css_classes(["suggested-action"]).sensitive(false).build();
        let header = adw::HeaderBar::builder().show_end_title_buttons(false).show_start_title_buttons(false).build();
        header.pack_start(&cancel);
        header.pack_end(&save);
        let view = adw::ToolbarView::new();
        view.add_top_bar(&header);
        view.set_content(Some(&body));
        let dialog = adw::Dialog::builder().title(t("profile.changeEmail", &[])).content_width(380).child(&view).build();
        let d = dialog.downgrade();
        cancel.connect_clicked(move |_| if let Some(d) = d.upgrade() { d.close(); });
        let s = save.downgrade();
        entry.connect_changed(move |e| if let Some(s) = s.upgrade() { s.set_sensitive(!e.text().trim().is_empty()) });
        let (me, d, e, err) = (Rc::downgrade(self), dialog.downgrade(), entry.downgrade(), error.downgrade());
        save.connect_clicked(move |b| {
            let (Some(me), Some(d), Some(e), Some(err)) = (me.upgrade(), d.upgrade(), e.upgrade(), err.upgrade()) else { return };
            let address = e.text().trim().to_string();
            if !address.contains('@') || !address.contains('.') {
                err.set_label(&t("error.invalid-email", &[]));
                return err.set_visible(true);
            }
            b.set_sensitive(false);
            let (page, button) = (Rc::downgrade(&me), b.downgrade());
            let body = json!({ "email": address, "language": gp_tui::texts::language() });
            api(&me.shell, "POST", "/api/auth/email", Some(body), move |shell, answer| match answer {
                Ok(v) => {
                    d.close();
                    if v["sent"].as_bool() == Some(true) { said(shell, &t("profile.linkSent", &[("email", &address)])) }
                    if let Some(p) = page.upgrade() { p.load() }
                }
                Err(code) => {
                    err.set_label(&refusal(&code));
                    err.set_visible(true);
                    if let Some(b) = button.upgrade() { b.set_sensitive(true) }
                }
            });
        });
        dialog.present(Some(&self.page));
    }

    /// Who the member is and whether the server mails, from the host; the page laid out again.
    fn load(self: &Rc<Self>) {
        let page = Rc::downgrade(self);
        api(&self.shell, "GET", "/api/auth/me", None, move |shell, answer| {
            let Some(p) = page.upgrade() else { return };
            if let Ok(me) = answer.and_then(|v| serde_json::from_value::<FullMe>(v).map_err(|e| e.to_string())) { *p.me.borrow_mut() = Some(me) }
            let page = Rc::downgrade(&p);
            api(shell, "GET", "/api/auth/state", None, move |_, answer| {
                let Some(p) = page.upgrade() else { return };
                p.mail.set(answer.is_ok_and(|v| v["mail"].as_bool() == Some(true)));
                p.fill();
            });
        });
    }
}

/// Inställningar opened again in the language just chosen, the window it was in closed.
fn relaunch(shell: &Rc<Shell>, from: &impl IsA<gtk::Widget>) {
    if let Some(w) = from.root().and_downcast::<gtk::Window>() { w.close() }
    crate::settings::open(shell);
}

/// Mina inställningar's page, filled now and again once the host has answered; with its state, which the caller keeps
/// while the page is shown.
pub fn page(shell: &Rc<Shell>) -> (adw::PreferencesPage, Rc<dyn std::any::Any>) {
    let mine = Rc::new(Mine { shell: shell.clone(), page: adw::PreferencesPage::new(), groups: RefCell::new(vec![]), me: RefCell::new(None), mail: Default::default() });
    mine.fill();
    if shell.sync.borrow().is_some() { mine.load() }
    (mine.page.clone(), mine)
}
