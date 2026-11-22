// The window and the way between its pages, as the Mac app's NavigationStack: the start page, a presentation pushed
// over it with ‹ back (presenting goes on when one goes back), and the output window. Every key and tap goes through
// `act`, which hands it to the core (App) and then draws what changed.
use crate::model::Model;
use crate::output::Output;
use crate::presentation::Page;
use crate::{faces, keys, look, start_page};
use adw::prelude::*;
use gp_tui::app::App;
use gp_tui::dates::local_today;
use gp_tui::keys::{page_key, Action};
use gp_tui::shell::{Caller, Core};
use gp_tui::texts::t;
use serde_json::json;
use std::cell::RefCell;
use std::rc::Rc;

pub struct Shell {
    pub model: RefCell<Model>,
    pub window: adw::ApplicationWindow,
    nav: adw::NavigationView,
    start: adw::NavigationPage,
    page: RefCell<Option<Page>>,
    output: RefCell<Option<Output>>,
}

impl Shell {
    pub fn start(app: &adw::Application) {
        faces::prepare();
        let look = look::read();
        look::apply(look.clone());
        let path = crate::db_path();
        // The demo's caller, as the Mac app's demo runs: no sign-in yet (docs/linux-app.md, "Not built").
        let core = match Core::open(&path.to_string_lossy(), Caller { user_id: "demo".into(), role: "admin".into() }) {
            Ok(core) => core,
            Err(e) => {
                eprintln!("gospel-presenter: {e}");
                app.quit();
                return;
            }
        };
        let nav = adw::NavigationView::new();
        let window = adw::ApplicationWindow::builder()
            .application(app)
            .title(look["app"]["name"].as_str().unwrap_or("Gospel Presenter"))
            .default_width(1440)
            .default_height(900)
            .content(&nav)
            .build();
        let start = adw::NavigationPage::builder().title(t("nav.presentations", &[])).tag("start").build();
        let shell = Rc::new(Shell {
            model: RefCell::new(Model::new(App::new(core, local_today()))),
            window, nav, start,
            page: RefCell::new(None),
            output: RefCell::new(None),
        });
        start_page::fill(&shell);
        shell.nav.add(&shell.start);
        let weak = Rc::downgrade(&shell);
        // ‹ back, or Esc the page did not take: the start page again, what is presented going on.
        shell.nav.connect_popped(move |_, _| if let Some(s) = weak.upgrade() { s.left() });
        shell.keys();
        shell.window.present();
        if let Some(id) = std::env::var("GP_OPEN").ok().filter(|id| !id.is_empty()) { shell.open(&id) }
        // The shell lives as long as the app: every callback holds it weakly, the app's shutdown strongly.
        let kept = shell.clone();
        app.connect_shutdown(move |_| { kept.model.borrow_mut().forget() });
    }

    /// The page's keys, before any widget takes them (arrows would move the focus between tiles).
    fn keys(self: &Rc<Self>) {
        let keys = gtk::EventControllerKey::new();
        keys.set_propagation_phase(gtk::PropagationPhase::Capture);
        let weak = Rc::downgrade(self);
        keys.connect_key_pressed(move |_, key, _, state| {
            let Some(s) = weak.upgrade() else { return gtk::glib::Propagation::Proceed };
            // A dialog open over the page (Avsluta's question) takes its own keys: ↵ answers it.
            if s.page.borrow().is_none() || s.window.visible_dialog().is_some() { return gtk::glib::Propagation::Proceed }
            // ↑ ↓ alone: the slide above or below as the tiles stand, not the one before or after.
            use gtk::gdk::ModifierType as M;
            let held = M::SHIFT_MASK | M::CONTROL_MASK | M::ALT_MASK | M::SUPER_MASK | M::META_MASK;
            if !state.intersects(held) && (key == gtk::gdk::Key::Up || key == gtk::gdk::Key::Down) {
                s.across(if key == gtk::gdk::Key::Down { 1 } else { -1 });
                return gtk::glib::Propagation::Stop;
            }
            match keys::key_event(key, state).and_then(page_key) {
                Some(action) => { s.act(action); gtk::glib::Propagation::Stop }
                None => gtk::glib::Propagation::Proceed,
            }
        });
        self.window.add_controller(keys);
    }

    /// ↑ ↓: the slide above (-1) or below (1) the one made ready, else the one shown, made ready (the core's
    /// `slideAcrossView`, the web's slideGridNav.ts); none past the first or last row.
    fn across(self: &Rc<Self>, dir: i64) {
        let tiles = match self.page.borrow().as_ref() { Some(page) => page.placed(), None => return };
        let key = {
            let m = self.model.borrow();
            let app = &m.app;
            let shown = app.is_live().then(|| app.live.item_id.clone().map(|i| format!("{i}/{}", app.live.part_index))).flatten();
            let from = app.state.picked.as_ref().map(|p| format!("{}/{}", p.item_id, p.part_index)).or(shown);
            app.core().view::<serde_json::Value>("slideAcrossView", json!({ "tiles": tiles, "from": from, "dir": dir }))
                .and_then(|v| v["key"].as_str().map(String::from))
        };
        let Some((item, part)) = key.as_deref().and_then(|k| k.rsplit_once('/')) else { return };
        let Ok(part) = part.parse::<i64>() else { return };
        self.act(Action::Event(json!({ "type": "pickAt", "itemId": item, "partIndex": part })));
    }

    /// A presentation opened: its page pushed over the start page.
    pub fn open(self: &Rc<Self>, id: &str) {
        self.model.borrow_mut().app.open(id);
        if self.model.borrow().app.page.is_none() {
            eprintln!("gospel-presenter: no page for {id}");
            return;
        }
        let page = Page::build(self);
        self.nav.push(&page.nav_page);
        *self.page.borrow_mut() = Some(page);
        self.refresh();
    }

    /// The presentation's page left: the start page read again.
    fn left(self: &Rc<Self>) {
        if self.page.borrow_mut().take().is_none() { return }
        self.model.borrow_mut().ticking = None;
        self.model.borrow_mut().app.act(Action::Back);
        start_page::fill(self);
    }

    /// A key's or a tap's action, as the core answers it; then what it changed drawn.
    pub fn act(self: &Rc<Self>, action: Action) {
        match action {
            Action::Back => { self.nav.pop(); return }
            Action::Output => { self.toggle_output(); return }
            Action::Quit => return,
            other => {
                let mut m = self.model.borrow_mut();
                let before = m.app.page.clone();
                m.app.act(other);
                if m.app.page != before { m.forget() }
                m.tick(None);
            }
        }
        // Esc that the page did not take sends the terminal back to its start page; here the window pops it.
        if self.model.borrow().app.page.is_none() && self.page.borrow().is_some() { self.nav.pop(); return }
        if self.model.borrow().app.ending { self.ask_to_end() }
        self.refresh();
    }

    /// A command of the core's (a change of the data), then the page read again and drawn; built again where its
    /// items changed. Select mode follows the order (an item removed is let go).
    pub fn run(self: &Rc<Self>, name: &str, args: serde_json::Value) {
        {
            let mut m = self.model.borrow_mut();
            m.app.run(name, args);
            m.forget();
            m.tick(None);
        }
        self.rebuild();
        self.refresh();
    }

    /// The page built again where its items are no longer those it was built for (one added, removed, renamed).
    fn rebuild(self: &Rc<Self>) {
        let stale = match (self.page.borrow().as_ref(), self.model.borrow().app.page.as_ref()) {
            (Some(built), Some(page)) => !built.built_for(page),
            _ => false,
        };
        if !stale { return }
        let page = Page::build(self);
        self.nav.replace(&[self.start.clone(), page.nav_page.clone()]);
        *self.page.borrow_mut() = Some(page);
    }

    /// The open presentation put in the trash (Radera presentation, asked first), and back to the start page.
    pub fn trash_presentation(self: &Rc<Self>, id: &str, at: i64) {
        let done = self.model.borrow_mut().app.run("trashPresentation", json!({ "id": id, "at": at }));
        if done { self.nav.pop(); } else { self.refresh() }
    }

    /// Markera chosen in an item's menu: select mode begun with it ticked.
    pub fn start_ticking(self: &Rc<Self>, item_id: &str) {
        self.model.borrow_mut().tick(Some(json!({ "type": "start", "first": item_id })));
        self.refresh();
    }

    /// An event of select mode (a row ticked, Markera alla), as the core answers it.
    pub fn tick(self: &Rc<Self>, event: serde_json::Value) {
        self.model.borrow_mut().tick(Some(event));
        self.refresh();
    }

    /// Klar: select mode ended, nothing removed.
    pub fn stop_ticking(self: &Rc<Self>) {
        self.model.borrow_mut().ticking = None;
        self.refresh();
    }

    /// The ticked items removed, after the question was answered; select mode ends.
    pub fn remove_ticked(self: &Rc<Self>) {
        let ids: Vec<String> = self.model.borrow().ticking.as_ref()
            .and_then(|s| s["ticked"].as_array().cloned()).unwrap_or_default()
            .iter().filter_map(|v| v.as_str().map(String::from)).collect();
        self.model.borrow_mut().ticking = None;
        for id in ids { self.run("removeItem", json!({ "itemId": id })) }
    }

    /// The page, the output window and the start page as the model now has them.
    pub fn refresh(self: &Rc<Self>) {
        if let Some(page) = self.page.borrow().as_ref() { page.refresh(self) }
        if let Some(out) = self.output.borrow().as_ref() { out.refresh() }
        if let Some(problem) = self.model.borrow_mut().app.refusal.take() { eprintln!("gospel-presenter: refused: {problem}") }
    }

    /// Avsluta presentation, asked first as the Mac app asks.
    fn ask_to_end(self: &Rc<Self>) {
        let dialog = adw::AlertDialog::new(Some(&t("live.end", &[])), Some(&t("live.endText", &[])));
        dialog.add_responses(&[("cancel", &t("common.cancel", &[])), ("end", &t("live.end", &[]))]);
        dialog.set_response_appearance("end", adw::ResponseAppearance::Destructive);
        dialog.set_close_response("cancel");
        let weak = Rc::downgrade(self);
        dialog.connect_response(None, move |_, response| {
            if let Some(s) = weak.upgrade() { s.act(Action::Confirm(response == "end")) }
        });
        dialog.present(Some(&self.window));
    }

    /// The output window on or off (o or Tab, as the terminal's output view).
    fn toggle_output(self: &Rc<Self>) {
        let open = self.output.borrow_mut().take();
        match open {
            Some(out) => out.close(),
            None => *self.output.borrow_mut() = Some(Output::open(self)),
        }
    }

    /// The output window closed by its own means.
    pub fn output_closed(&self) { self.output.borrow_mut().take(); }

    pub fn start_page(&self) -> &adw::NavigationPage { &self.start }
}
