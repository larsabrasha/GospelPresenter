// The output window (the Mac app's, Slides.swift): what the outputs show, filling a window of its own, full screen on
// a second monitor where there is one; its keys the terminal's output view's (→ Space ↵ step, ← back, b Släck; o, Tab
// or Esc closes it).
use crate::keys;
use crate::shell::Shell;
use crate::tiles;
use adw::prelude::*;
use gp_tui::keys::output_key;
use gp_tui::texts::t;
use std::rc::Rc;

pub struct Output {
    window: gtk::Window,
    picture: gtk::DrawingArea,
}

impl Output {
    pub fn open(shell: &Rc<Shell>) -> Output {
        let (view, picture) = tiles::live_picture(shell, false);
        let window = gtk::Window::builder().title(t("live.badge", &[])).default_width(960).default_height(540).child(&view).build();
        window.set_transient_for(Some(&shell.window));
        let keys = gtk::EventControllerKey::new();
        let weak = Rc::downgrade(shell);
        keys.connect_key_pressed(move |_, key, _, state| {
            let Some(s) = weak.upgrade() else { return gtk::glib::Propagation::Proceed };
            match keys::key_event(key, state).and_then(output_key) {
                Some(action) => { s.act(action); gtk::glib::Propagation::Stop }
                None => gtk::glib::Propagation::Proceed,
            }
        });
        window.add_controller(keys);
        let weak = Rc::downgrade(shell);
        window.connect_close_request(move |_| {
            if let Some(s) = weak.upgrade() { s.output_closed() }
            gtk::glib::Propagation::Proceed
        });
        let monitors = WidgetExt::display(&window).monitors();
        window.present();
        if monitors.n_items() > 1 {
            if let Some(second) = monitors.item(1).and_downcast::<gtk::gdk::Monitor>() { window.fullscreen_on_monitor(&second) }
        }
        Output { window, picture }
    }

    pub fn refresh(&self) { self.picture.queue_draw() }

    pub fn close(self) { self.window.destroy() }
}
