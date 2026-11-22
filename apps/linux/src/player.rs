// The audio and video of what is shown, played on this device while it presents (spec 04 §1b, LIVE-R6; docs/live.md
// "Where audio and video play"; the Mac app's LivePlayer.swift): what the player does as the live state changes is the
// core's (`playbackStepView`: a video or audio item shown plays from its start, anything else stops it, Släck pauses
// it and the slide shown again plays on, unless it was paused by hand), the item's file and the next video the core's
// too (`livePlaybackView`, `itemAudioView`), and the controls and Tona ut (`playerControlsView`, `fadeOutView`); this
// does what they say with one GTK media stream (GStreamer), fetching a file not here yet (media.rs) and the next video
// in advance. Its picture shows in every live picture of this device (tiles.rs `live_view`), between the slide and its
// overlay; its sound plays here once.
use crate::shell::Shell;
use adw::prelude::*;
use gp_core::view_types::{FadeStep, PlayerControls};
use serde::Deserialize;
use serde_json::{json, Value};
use std::cell::RefCell;
use std::collections::HashSet;
use std::rc::Rc;

#[derive(Deserialize, Clone, Default)]
struct File { hash: String }
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct Playback { item: Option<Value>, video: Option<File>, next_video: Option<File> }
#[derive(Deserialize)]
struct Step { #[serde(rename = "do")] action: String, #[serde(rename = "itemId")] item_id: Option<String>, kind: Option<String> }
#[derive(Deserialize)]
struct Answer { player: Value, steps: Vec<Step> }

#[derive(Default)]
struct Player {
    stream: Option<gtk::MediaFile>,
    /// The item loaded (or waiting for its file), and whether it is a video or an audio file.
    item_id: Option<String>,
    kind: Option<String>,
    /// What the player holds, as the core keeps count of it (`playbackStepView`'s `player`).
    held: Value,
    /// Loads asked for, so a file that comes late never plays over a newer one.
    turn: u64,
    /// The videos it has or fetched in advance: the media sync keeps them.
    in_use: HashSet<String>,
    /// The live state last followed.
    followed: Option<Value>,
    /// Tona ut under way: when it began and from which volume.
    fading: Option<(std::time::Instant, f64)>,
    /// Every live picture's video and overlay layer, drawn again as the player changes.
    screens: Vec<(gtk::glib::WeakRef<gtk::Picture>, gtk::glib::WeakRef<gtk::DrawingArea>)>,
}

thread_local! { static PLAYER: RefCell<Player> = RefCell::new(Player::default()); }

fn with<T>(f: impl FnOnce(&mut Player) -> T) -> T { PLAYER.with(|p| f(&mut p.borrow_mut())) }

/// The videos the player needs kept (the media sync's `inUse`).
pub fn in_use() -> Vec<String> { with(|p| p.in_use.iter().cloned().collect()) }

/// The video's stream for the live picture of `item`: while a video of it is ready to show. Under Släck the outputs
/// are black: pass no item.
pub fn video_for(item: Option<&str>) -> Option<gtk::MediaFile> {
    with(|p| {
        let stream = p.stream.clone().filter(|s| s.is_prepared())?;
        (p.kind.as_deref() == Some("video") && item.is_some() && item == p.item_id.as_deref()).then_some(stream)
    })
}

/// The item whose picture the outputs show: none under Släck.
pub fn shown_item(shell: &Rc<Shell>) -> Option<String> {
    let m = shell.model.borrow();
    m.app.live.item_id.clone().filter(|_| !m.app.live.black)
}

/// A live picture's video layer and overlay layer, kept up to date from now on.
pub fn add_screen(video: &gtk::Picture, overlay: &gtk::DrawingArea) { with(|p| p.screens.push((video.downgrade(), overlay.downgrade()))) }

/// Every live picture's video shown or hidden, its overlay drawn again.
fn redraw(shell: &Rc<Shell>) {
    let video = video_for(shown_item(shell).as_deref());
    with(|p| p.screens.retain(|(v, o)| v.upgrade().is_some() && o.upgrade().is_some()));
    let screens: Vec<_> = with(|p| p.screens.iter().filter_map(|(v, o)| Some((v.upgrade()?, o.upgrade()?))).collect());
    for (picture, overlay) in screens {
        picture.set_paintable(video.as_ref());
        picture.set_visible(video.is_some());
        overlay.queue_draw();
    }
}

/// The live state as it stands: what the core says the player does, done. Presenting here only; anything else stops it.
pub fn follow(shell: &Rc<Shell>) {
    let (live, here) = { let m = shell.model.borrow(); (m.app.live.clone(), !m.app.remote) };
    let pointer = here.then(|| serde_json::to_value(&live).unwrap_or_default());
    if with(|p| p.followed == pointer) { return }
    with(|p| p.followed = pointer.clone());
    let Some(pid) = live.presentation_id.clone().filter(|_| here) else { return stop(shell) };
    let core = |name: &str, args: Value| shell.model.borrow().app.core().call(name, args).unwrap_or(Value::Null);
    let shown: Playback = serde_json::from_value(core("livePlaybackView", json!({ "presentationId": pid, "itemId": live.item_id }))).unwrap_or_default();
    let mut holds = with(|p| p.held.clone());
    if !holds.is_object() { holds = json!({ "itemId": null, "black": false, "playing": false, "playOnShow": false }) }
    holds["playing"] = json!(with(|p| p.stream.as_ref().is_some_and(|s| s.is_playing())));
    let args = json!({ "player": holds, "presentationId": pid, "item": shown.item, "black": live.black });
    let Ok(answer) = serde_json::from_value::<Answer>(core("playbackStepView", args)) else { return };
    with(|p| {
        p.held = answer.player.clone();
        p.in_use = [&shown.video, &shown.next_video].into_iter().flatten().map(|f| f.hash.clone()).collect();
    });
    if let Some(next) = &shown.next_video { crate::media::file(shell, &next.hash, |_, _| {}) }
    for step in answer.steps {
        match step.action.as_str() {
            "stop" => unload(),
            "load" => {
                let Some(id) = step.item_id else { continue };
                let file = if step.kind.as_deref() == Some("video") { shown.video.clone() }
                    else { serde_json::from_value::<File>(core("itemAudioView", json!({ "itemId": id }))).ok() };
                let mine = with(|p| {
                    p.item_id = Some(id.clone());
                    p.kind = step.kind.clone();
                    p.turn += 1;
                    p.turn
                });
                let Some(file) = file else { continue };
                crate::media::file(shell, &file.hash, move |shell, path| {
                    let Some(path) = path.filter(|_| with(|p| p.turn == mine)) else { return };
                    load(shell, &path, &id);
                });
            }
            "pause" => if let Some(s) = with(|p| p.stream.clone()) { s.pause() },
            "play" => if let Some(s) = with(|p| p.stream.clone()) { s.play() },
            _ => {}
        }
    }
    redraw(shell);
}

/// A file in the stream from its start, played as the core last said: a slide shown again while the file came plays it.
fn load(shell: &Rc<Shell>, path: &std::path::Path, item: &str) {
    unload_stream();
    let stream = gtk::MediaFile::for_filename(path);
    let weak = Rc::downgrade(shell);
    stream.connect_prepared_notify(move |_| if let Some(s) = weak.upgrade() { redraw(&s); s.refresh_player() });
    let weak = Rc::downgrade(shell);
    stream.connect_playing_notify(move |_| if let Some(s) = weak.upgrade() { s.refresh_player() });
    if let Some(e) = stream.error() { eprintln!("gospel-presenter: a file not played: {e}") }
    let play = with(|p| p.held["playing"].as_bool() == Some(true) && p.held["itemId"].as_str() == Some(item));
    if play { stream.play() }
    with(|p| p.stream = Some(stream));
    redraw(shell);
}

fn unload_stream() {
    if let Some(s) = with(|p| { p.fading = None; p.stream.take() }) { s.pause(); s.set_file(None::<&gtk::gio::File>) }
}

fn unload() {
    unload_stream();
    with(|p| { p.item_id = None; p.kind = None; p.turn += 1 });
}

/// Nothing to play: stopped, its file let go.
fn stop(shell: &Rc<Shell>) {
    unload();
    with(|p| { p.held = Value::Null; p.in_use.clear() });
    redraw(shell);
}

/// The controls of the item shown, while it is a video or audio file this player holds: the core's
/// (`playerControlsView`).
pub fn controls(shown: Option<&str>) -> Option<(String, PlayerControls, f64)> {
    let (kind, stream, fading) = with(|p| (p.kind.clone(), p.stream.clone(), p.fading.is_some()));
    let (kind, stream) = (kind?, stream.filter(|_| shown.is_some() && with(|p| p.item_id.as_deref() == shown))?);
    let seconds = |us: i64| us as f64 / 1_000_000.0;
    let args = json!({ "kind": kind, "playing": stream.is_playing(), "position": seconds(stream.timestamp()), "duration": seconds(stream.duration()), "fading": fading });
    let out = gp_core::start(json!({ "name": "playerControlsView", "args": args, "ctx": {} }));
    let gp_core::Step::Done(v) = out else { return None };
    Some((kind, serde_json::from_value(v).ok()?, seconds(stream.timestamp())))
}

/// Play or pause by hand; at its end, it plays from its start.
pub fn toggle() {
    let Some(s) = with(|p| p.stream.clone()) else { return };
    if s.is_playing() { return s.pause() }
    if s.is_ended() || (s.duration() > 0 && s.timestamp() >= s.duration() - 50_000) { s.seek(0) }
    s.play();
}

pub fn seek(seconds: f64) { if let Some(s) = with(|p| p.stream.clone()) { s.seek((seconds * 1_000_000.0) as i64) } }

/// Tona ut: the volume down as the core says (`fadeOutView`), then paused, back at the start, at its volume again.
pub fn fade_out(shell: &Rc<Shell>) {
    let Some(s) = with(|p| p.stream.clone()).filter(|s| s.is_playing()) else { return };
    if with(|p| p.fading.is_some()) { return }
    with(|p| p.fading = Some((std::time::Instant::now(), s.volume())));
    fade_tick(shell);
    shell.refresh_player();
}

fn fade_tick(shell: &Rc<Shell>) {
    let Some(((began, from), s)) = with(|p| p.fading.zip(p.stream.clone())) else { return };
    let args = json!({ "from": from, "elapsedMs": began.elapsed().as_millis() as i64 });
    let gp_core::Step::Done(v) = gp_core::start(json!({ "name": "fadeOutView", "args": args, "ctx": {} })) else { return };
    let Ok(step) = serde_json::from_value::<FadeStep>(v) else { return };
    if step.done {
        s.pause();
        s.seek(0);
        s.set_volume(from);
        with(|p| p.fading = None);
        return shell.refresh_player();
    }
    s.set_volume(step.volume);
    let weak = Rc::downgrade(shell);
    gtk::glib::timeout_add_local_once(std::time::Duration::from_millis(step.next_ms.max(1) as u64), move || {
        if let Some(s) = weak.upgrade() { fade_tick(&s) }
    });
}
