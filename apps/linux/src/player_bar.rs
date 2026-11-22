// Under the live picture while a video or audio item is live: its controls (the Mac app's PlayerBar and
// PlayerControls in LiveMedia.swift, the web's PlayerControls and AudioPlayer): play or pause, the position to drag,
// the time, and an audio file's Tona ut, each as the core says (`playerControlsView`, through player.rs); drawn again
// four times a second while it shows, as the Mac's player reports its time.
use crate::player;
use crate::shell::Shell;
use adw::prelude::*;
use gp_tui::texts::t;
use std::cell::Cell;
use std::rc::Rc;

pub struct PlayerBar {
    pub root: gtk::Box,
    toggle: gtk::Button,
    scale: gtk::Scale,
    time: gtk::Label,
    fade: gtk::Button,
    /// The position being set from the player, not dragged.
    setting: Rc<Cell<bool>>,
}

impl PlayerBar {
    pub fn build(shell: &Rc<Shell>) -> PlayerBar {
        let toggle = gtk::Button::builder().css_classes(["flat", "circular"]).build();
        toggle.connect_clicked(|_| player::toggle());
        let scale = gtk::Scale::builder().orientation(gtk::Orientation::Horizontal).hexpand(true).draw_value(false).build();
        let setting = Rc::new(Cell::new(false));
        let quiet = setting.clone();
        scale.connect_value_changed(move |s| if !quiet.get() { player::seek(s.value()) });
        let time = gtk::Label::builder().css_classes(["dim-label", "caption", "numeric"]).build();
        let fade = gtk::Button::builder().css_classes(["flat"]).build();
        let weak = Rc::downgrade(shell);
        fade.connect_clicked(move |_| if let Some(s) = weak.upgrade() { player::fade_out(&s) });
        let root = gtk::Box::builder().orientation(gtk::Orientation::Horizontal).spacing(8).visible(false).build();
        root.append(&toggle);
        root.append(&scale);
        root.append(&time);
        root.append(&fade);
        // Its time as it plays, while the bar is there.
        let (weak, bar) = (Rc::downgrade(shell), root.downgrade());
        gtk::glib::timeout_add_local(std::time::Duration::from_millis(250), move || {
            let (Some(s), Some(bar)) = (weak.upgrade(), bar.upgrade()) else { return gtk::glib::ControlFlow::Break };
            if bar.is_mapped() { s.refresh_player() }
            gtk::glib::ControlFlow::Continue
        });
        PlayerBar { root, toggle, scale, time, fade, setting }
    }

    /// The controls of the item shown, or none.
    pub fn update(&self, shell: &Rc<Shell>) {
        let shown = shell.model.borrow().app.live.item_id.clone();
        let Some((_, c, position)) = player::controls(shown.as_deref()) else { return self.root.set_visible(false) };
        self.root.set_visible(true);
        self.toggle.set_icon_name(if c.icon == "pause" { "media-playback-pause-symbolic" } else { "media-playback-start-symbolic" });
        self.toggle.set_tooltip_text(Some(&t(&c.toggle, &[])));
        self.scale.set_tooltip_text(Some(&t(&c.seek, &[])));
        self.setting.set(true);
        self.scale.set_range(0.0, c.end);
        self.scale.set_value(position);
        self.setting.set(false);
        self.time.set_label(&c.time);
        match c.fade {
            Some(f) => {
                self.fade.set_visible(true);
                self.fade.set_label(&t(&f.text, &[]));
                self.fade.set_sensitive(f.enabled);
            }
            None => self.fade.set_visible(false),
        }
    }
}
