// A slide in the middle column (the Mac app's SlideTile, Thumbnails.swift): its picture painted from the core's
// layout with its label, VISAS or NÄSTA at its top left, its number at its bottom right, rounded; the slide made ready
// ringed in the accent, the one shown in red. A tap is the core's `show` (shown while presenting, else made ready).
// The live picture is the same slide painted as the outputs draw it: no label, the credits, black when nothing shows.
use crate::painter;
use crate::shell::Shell;
use adw::prelude::*;
use gp_tui::keys::Action;
use gp_tui::texts::t;
use gp_tui::views::SlideAt;
use serde_json::json;
use std::f64::consts::{FRAC_PI_2, PI};
use std::rc::Rc;

pub const WIDTH: i32 = 320;

/// A rounded rectangle's path.
pub fn rounded(cr: &cairo::Context, x: f64, y: f64, w: f64, h: f64, r: f64) {
    cr.new_sub_path();
    cr.arc(x + w - r, y + r, r, -FRAC_PI_2, 0.0);
    cr.arc(x + w - r, y + h - r, r, 0.0, FRAC_PI_2);
    cr.arc(x + r, y + h - r, r, FRAC_PI_2, PI);
    cr.arc(x + r, y + r, r, PI, 1.5 * PI);
    cr.close_path();
}

/// A small pill with white text: VISAS on red, NÄSTA on black at 60 %.
fn badge(widget: &gtk::DrawingArea, cr: &cairo::Context, text: &str, shown: bool) {
    let layout = widget.create_pango_layout(Some(text));
    let mut font = gtk::pango::FontDescription::from_string("sans-serif Bold");
    font.set_absolute_size(11.0 * f64::from(gtk::pango::SCALE));
    layout.set_font_description(Some(&font));
    let (_, r) = layout.pixel_extents();
    let (w, h) = (f64::from(r.width()) + 14.0, f64::from(r.height()) + 6.0);
    rounded(cr, 8.0, 8.0, w, h, h / 2.0);
    if shown { cr.set_source_rgb(0.937, 0.267, 0.267) } else { cr.set_source_rgba(0.0, 0.0, 0.0, 0.6) }
    let _ = cr.fill();
    cr.set_source_rgb(1.0, 1.0, 1.0);
    cr.move_to(15.0, 11.0);
    pangocairo::functions::show_layout(cr, &layout);
}

/// The tile of slide `at` of presentation `pid`, numbered `n` from 1.
pub fn tile(shell: &Rc<Shell>, pid: &str, at: SlideAt, n: usize) -> gtk::DrawingArea {
    let area = gtk::DrawingArea::builder().content_width(WIDTH).content_height(WIDTH * 9 / 16).build();
    let (weak, pid_d, at_d) = (Rc::downgrade(shell), pid.to_string(), at.clone());
    area.set_draw_func(move |widget, cr, w, h| {
        let Some(s) = weak.upgrade() else { return };
        let (w, h) = (f64::from(w), f64::from(h));
        let mut m = s.model.borrow_mut();
        let painted = m.painted(&pid_d, &at_d);        let _ = cr.save();
        rounded(cr, 0.0, 0.0, w, h, 10.0);
        cr.clip();
        painter::empty(cr, w, h);
        if let Some(l) = &painted.layout { painter::paint(cr, l, painted.label.as_ref(), w, h) }
        let live_here = m.app.live.presentation_id.as_deref() == Some(pid_d.as_str());
        let marks = &m.app.marks;
        let mark = |x: &Option<gp_tui::views::MarkAt>| live_here && x.as_ref().and_then(|x| x.at()).as_ref() == Some(&at_d);
        let (shown, next) = (mark(&marks.shown), mark(&marks.next));
        if shown || next { badge(widget, cr, &t(if shown { "live.shownBadge" } else { "live.nextBadge" }, &[]), shown) }
        let number = widget.create_pango_layout(Some(&n.to_string()));
        let (_, r) = number.pixel_extents();
        cr.move_to(w - 8.0 - f64::from(r.width()), h - 8.0 - f64::from(r.height()));
        cr.set_source_rgba(0.0, 0.0, 0.0, 0.6);
        pangocairo::functions::layout_path(cr, &number);
        cr.set_line_width(3.0);
        let _ = cr.stroke_preserve();
        cr.set_source_rgb(1.0, 1.0, 1.0);
        let _ = cr.fill();
        let _ = cr.restore();
        let picked = m.app.state.picked.as_ref() == Some(&at_d);
        if picked || shown {
            let ring = if picked { crate::look::accent() } else { gtk::gdk::RGBA::new(0.937, 0.267, 0.267, 1.0) };
            cr.set_source_rgba(ring.red().into(), ring.green().into(), ring.blue().into(), 1.0);
            rounded(cr, 2.0, 2.0, w - 4.0, h - 4.0, 9.0);
            cr.set_line_width(4.0);
            let _ = cr.stroke();
        }
    });
    let click = gtk::GestureClick::new();
    let weak = Rc::downgrade(shell);
    click.connect_released(move |_, _, _, _| {
        if let Some(s) = weak.upgrade() {
            s.act(Action::Event(json!({ "type": "show", "itemId": at.item_id, "partIndex": at.part_index })))
        }
    });
    area.add_controller(click);
    area.set_cursor_from_name(Some("pointer"));
    area
}

/// The live picture: the slide presented as the outputs draw it, black before the first slide and after Släck.
pub fn live_picture(shell: &Rc<Shell>, rounded_corners: bool) -> gtk::DrawingArea {
    let area = gtk::DrawingArea::new();
    let weak = Rc::downgrade(shell);
    area.set_draw_func(move |_, cr, w, h| {
        let (w, h) = (f64::from(w), f64::from(h));
        let Some(s) = weak.upgrade() else { return };
        if rounded_corners {
            rounded(cr, 0.0, 0.0, w, h, 12.0);
            cr.clip();
        }
        painter::empty(cr, w, h);
        let shown = s.model.borrow_mut().shown();
        if let Some(l) = shown.and_then(|p| p.layout) { painter::paint(cr, &l, None, w, h) }
    });
    area
}
