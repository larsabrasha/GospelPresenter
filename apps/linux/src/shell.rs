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
            match keys::key_event(key, state).and_then(page_key) {
                Some(action) => { s.act(action); gtk::glib::Propagation::Stop }
                None => gtk::glib::Propagation::Proceed,
            }
        });
        self.window.add_controller(keys);
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
            }
        }
        // Esc that the page did not take sends the terminal back to its start page; here the window pops it.
        if self.model.borrow().app.page.is_none() && self.page.borrow().is_some() { self.nav.pop(); return }
        if self.model.borrow().app.ending { self.ask_to_end() }
        self.refresh();
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
