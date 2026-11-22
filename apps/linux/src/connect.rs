// Connecting the device to a church's desktop host (the Mac app's Connect.swift, docs/sign-in-and-pairing.md): its
// address, then the six-digit code the host shows under Enheter → Anslut enhet, or no code on a host that lets devices
// in for development (GP_DEV_PAIR=1). A host's own certificate is shown once, to accept, as a browser's warning is.
// Visa demodata opens the demo on this device alone.
use crate::net::{self, Failure, Pairing, Server};
use crate::shell::Shell;
use crate::sync;
use adw::prelude::*;
use gp_tui::texts::{language, t};
use std::rc::Rc;

/// The few texts only the native apps have (the Mac's `n`, Texts.swift): the web has no address to type, no
/// certificate to accept, no demo, so they are not in i18n.ts, whose every key the web's own code must use.
pub fn n(key: &str, vars: &[(&str, &str)]) -> String {
    let (sv, en) = match key {
        "demo" => ("Visa demodata", "Show the demo data"),
        "addressHint" => ("Adressen visas på värden: https och port 47843, eller http och port 47800.", "The host shows its address: https and port 47843, or http and port 47800."),
        "notAHost" => ("Det svarar inte som kyrkans dator. Inloggning mot molnet finns inte i appen än.", "That is not a church's host computer. Signing in to the cloud is not in the app yet."),
        "refused" => ("Värden sa nej ({code}).", "The host said no ({code})."),
        "certificate" => ("Värdens certifikat", "The host's certificate"),
        "trust" => ("Lita på det", "Trust it"),
        "certificateText" => ("{host} har ett eget certifikat. Lita bara på det om fingeravtrycket är detsamma som på värden:\n\n{fingerprint}", "{host} has a certificate of its own. Trust it only if the fingerprint is the same as on the host:\n\n{fingerprint}"),
        _ => return key.to_string(),
    };
    let mut text = if language() == "en" { en } else { sv }.to_string();
    for (name, value) in vars { text = text.replace(&format!("{{{name}}}"), value) }
    text
}

/// The page that asks for the host, in place of the start page's lists.
pub fn show(shell: &Rc<Shell>) {
    let address = adw::EntryRow::builder().title(t("server.address", &[])).build();
    if let Ok(last) = std::fs::read_to_string(net::config_dir().join("last-server")) { address.set_text(last.trim()) }
    let code = adw::EntryRow::builder().title(t("pair.code", &[])).input_purpose(gtk::InputPurpose::Digits).visible(false).build();
    let group = adw::PreferencesGroup::builder().title(t("pair.title", &[])).description(n("addressHint", &[])).build();
    group.add(&address);
    group.add(&code);
    let problem = gtk::Label::builder().wrap(true).xalign(0.0).css_classes(["error"]).visible(false).build();
    let connect = gtk::Button::builder().label(t("pair.submit", &[])).css_classes(["suggested-action", "pill"]).halign(gtk::Align::Center).build();
    let demo = gtk::Button::builder().label(n("demo", &[])).css_classes(["flat"]).halign(gtk::Align::Center).build();
    let buttons = gtk::Box::builder().orientation(gtk::Orientation::Vertical).spacing(12).margin_top(12).build();
    buttons.append(&problem);
    buttons.append(&connect);
    buttons.append(&demo);
    let bottom = adw::PreferencesGroup::new();
    bottom.add(&buttons);
    let page = adw::PreferencesPage::new();
    page.add(&group);
    page.add(&bottom);
    let bar = adw::ToolbarView::new();
    bar.add_top_bar(&adw::HeaderBar::builder().title_widget(&adw::WindowTitle::new("Gospel Presenter", "")).build());
    bar.set_content(Some(&page));
    shell.start_page().set_child(Some(&bar));

    let form = Form { address, code, problem, connect: connect.clone() };
    let enable = { let f = form.clone(); move || f.enable() };
    form.address.connect_changed({ let e = enable.clone(); move |_| e() });
    form.code.connect_changed(move |_| enable());
    form.enable();
    connect.connect_clicked({ let f = form.clone(); move |_| f.connect() });
    form.address.connect_entry_activated({ let f = form.clone(); move |_| f.connect() });
    form.code.connect_entry_activated({ let f = form.clone(); move |_| f.connect() });
    let weak = Rc::downgrade(shell);
    demo.connect_clicked(move |_| if let Some(s) = weak.upgrade() { s.open_demo() });
}

#[derive(Clone)]
struct Form { address: adw::EntryRow, code: adw::EntryRow, problem: gtk::Label, connect: gtk::Button }

impl Form {
    /// Anslut takes an address, and once the host asks for one, a code of six digits.
    fn enable(&self) {
        let code = self.code.text();
        let ok = !self.address.text().trim().is_empty() && (!self.code.is_visible() || (code.len() == 6 && code.chars().all(|c| c.is_ascii_digit())));
        self.connect.set_sensitive(ok);
    }

    fn say(&self, text: Option<String>) {
        self.problem.set_visible(text.is_some());
        self.problem.set_label(text.as_deref().unwrap_or(""));
    }

    /// The host asked whether it takes a code; then paired, with the code once it asks for one.
    fn connect(&self) {
        if !self.connect.is_sensitive() { return }
        let server = match Server::new(&self.address.text()) {
            Ok(s) => s,
            Err(_) => return self.say(Some(t("server.unreachable", &[]))),
        };
        let _ = std::fs::write(net::config_dir().join("last-server"), self.address.text().trim());
        self.say(None);
        self.connect.set_sensitive(false);
        let code = self.code.is_visible().then(|| self.code.text().to_string());
        let name = gtk::glib::host_name().to_string();
        let form = self.clone();
        sync::in_background(move || -> Result<Result<Option<net::Session>, String>, Failure> {
            match net::pairing(&server)? {
                Pairing::NotAHost => Ok(Err(n("notAHost", &[]))),
                Pairing::Dev => Ok(net::claim(&server, None, &name)?.map(Some).map_err(refused)),
                Pairing::Code if code.is_none() => Ok(Ok(None)),
                Pairing::Code => Ok(net::claim(&server, code.as_deref(), &name)?.map(Some).map_err(refused)),
            }
        }, move |s, answer| {
            form.enable();
            match answer {
                Ok(Ok(Some(session))) => if let Err(e) = sync::open(s, session) { form.say(Some(n("refused", &[("code", &e)]))) } else { s.signed_in() },
                Ok(Ok(None)) => { form.code.set_visible(true); form.code.grab_focus(); form.enable() }
                Ok(Err(text)) => form.say(Some(text)),
                Err(Failure::Untrusted(u)) => form.ask_to_trust(s, u),
                Err(Failure::Unreachable(_)) => form.say(Some(t("server.unreachable", &[]))),
            }
        });
    }

    /// A host's own certificate: its fingerprint shown, to compare with the host's and accept; then connected again.
    fn ask_to_trust(&self, shell: &Rc<Shell>, u: net::Untrusted) {
        let dialog = adw::AlertDialog::new(Some(&n("certificate", &[])), Some(&n("certificateText", &[("host", &u.host), ("fingerprint", &u.fingerprint)])));
        dialog.add_responses(&[("cancel", &t("common.cancel", &[])), ("trust", &n("trust", &[]))]);
        dialog.set_close_response("cancel");
        let form = self.clone();
        dialog.connect_response(None, move |_, r| {
            if r != "trust" { return }
            net::trust(&u);
            form.connect();
        });
        dialog.present(Some(&shell.window));
    }
}

/// The host's refusal as the person reads it.
fn refused(code: String) -> String {
    if code == "pair-code-invalid" { t("error.pair-code-invalid", &[]) } else { n("refused", &[("code", &code)]) }
}
