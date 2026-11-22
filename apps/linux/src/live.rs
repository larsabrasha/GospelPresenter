// The device's live socket (`/api/live/socket`), as the Mac app's LiveStatus.swift: who is online and who watches, for
// Utgångar; this device as its live session's owner while it presents; a session elsewhere driven from here (Ta
// kontroll). What is reported, which command is taken, which outputs are let go, what a controller shows, when to ping
// and when to connect again are the core's (`liveStepView`); this does what it says: the socket on a thread of its
// own, the timers, and the app's live state changed or shown.
use crate::net::{self, Server, Session};
use crate::shell::Shell;
use gp_core::view_types::{LiveEffect, LiveEvent, LiveState, LiveStep};
use gp_tui::views::LivePointer;
use serde_json::{json, Value};
use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::Arc;

pub struct Live {
    server: Server,
    session: Session,
    /// The core's state (`LiveState`, crates/gp-core/src/view_types.rs), given back with each event.
    pub state: LiveState,
    timers: HashMap<String, gtk::glib::SourceId>,
    /// The socket's thread runs while this is false; messages to send go through `out`.
    socket: Option<(Arc<AtomicBool>, Sender<String>)>,
}


thread_local! {
    /// The live socket the window holds, while signed in to a host.
    pub static LIVE: RefCell<Option<Live>> = const { RefCell::new(None) };
}

fn now() -> i64 { std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis() as i64) }

/// Opened once signed in: the organisation's sessions listed, this device's reported while it presents.
pub fn start(shell: &Rc<Shell>, session: &Session) {
    let Ok(server) = Server::new(&session.server) else { return };
    let init = json!({ "init": { "sessionId": gtk::glib::uuid_string_random().to_string(), "deviceName": gtk::glib::host_name().to_string() } });
    let first = shell.model.borrow().app.core().call("liveStepView", init).ok().and_then(|v| serde_json::from_value::<LiveStep>(v).ok());
    let Some(LiveStep { state, .. }) = first else { return };
    LIVE.with(|l| *l.borrow_mut() = Some(Live { server, session: session.clone(), state, timers: HashMap::new(), socket: None }));
    step(shell, LiveEvent::Start);
}

/// Signed out: the socket closed and forgotten.
pub fn stop(shell: &Rc<Shell>) {
    step(shell, LiveEvent::Stop);
    if let Some(l) = LIVE.with(|l| l.borrow_mut().take()) { for (_, t) in l.timers { t.remove() } }
}

/// Reads the live socket's state, if signed in.
pub fn with<T>(f: impl FnOnce(&Live) -> T) -> Option<T> { LIVE.with(|l| l.borrow().as_ref().map(f)) }

/// Gives the core an event with the state it last gave, and does what it answers, in order.
pub fn step(shell: &Rc<Shell>, event: LiveEvent) {
    let Some(state) = with(|l| l.state.clone()) else { return };
    let out = shell.model.borrow().app.core().call("liveStepView", json!({ "state": state, "event": event, "now": now() }));
    let Some(out) = out.ok().and_then(|v| serde_json::from_value::<LiveStep>(v).ok()) else { return };
    // What the pages show of it: the outputs, the sessions to drive, the connection.
    let shown = |s: &LiveState| (s.sessions.clone(), s.online.clone(), s.screens.clone(), s.chosen.clone(), s.remote, s.controllable.clone());
    let listed = shown(&state) != shown(&out.state);
    LIVE.with(|l| if let Some(l) = l.borrow_mut().as_mut() { l.state = out.state });
    for effect in out.effects { perform(shell, effect) }
    if listed { shell.live_listed() }
}

fn perform(shell: &Rc<Shell>, effect: LiveEffect) {
    match effect {
        LiveEffect::OpenSocket => open(shell),
        LiveEffect::CloseSocket => {
            if let Some((stop, _)) = LIVE.with(|l| l.borrow_mut().as_mut().and_then(|l| l.socket.take())) { stop.store(true, Ordering::Relaxed) }
            step(shell, LiveEvent::SocketClosed);
        }
        LiveEffect::Send { message } => {
            let tx = LIVE.with(|l| l.borrow().as_ref().and_then(|l| l.socket.as_ref().map(|s| s.1.clone())));
            if let Some(tx) = tx { let _ = tx.send(message.to_string()); }
        }
        LiveEffect::Timer { name, ms } => {
            let (weak, fired) = (Rc::downgrade(shell), name.clone());
            let id = gtk::glib::timeout_add_local_once(std::time::Duration::from_millis(ms.max(0) as u64), move || {
                LIVE.with(|l| if let Some(l) = l.borrow_mut().as_mut() { l.timers.remove(&fired); });
                if let Some(s) = weak.upgrade() { step(&s, LiveEvent::Timer { name: fired }) }
            });
            let old = LIVE.with(|l| l.borrow_mut().as_mut().and_then(|l| l.timers.insert(name, id)));
            if let Some(old) = old { old.remove() }
        }
        LiveEffect::Apply { change } => shell.live_apply(change),
        LiveEffect::Mirror { pointer } => if let Ok(p) = serde_json::from_value::<LivePointer>(pointer) { shell.live_mirror(p) },
        LiveEffect::Lost => shell.stop_controlling(),
        LiveEffect::Unconfirmed => shell.remote_unconfirmed(),
        // Audio and video commands: the Linux app plays no media yet (docs/native-parity.md).
        LiveEffect::Audio { .. } | LiveEffect::Video { .. } => {}
    }
}

/// One connection, on a thread: its opening, each message and its closing told to the core; what to send handed to it.
fn open(shell: &Rc<Shell>) {
    let Some((server, session)) = with(|l| (l.server.clone(), l.session.clone())) else { return };
    let Some(post) = crate::sync::poster() else { return };
    let stop = Arc::new(AtomicBool::new(false));
    let (tx, rx) = channel::<String>();
    let old = LIVE.with(|l| l.borrow_mut().as_mut().and_then(|l| l.socket.replace((stop.clone(), tx))));
    if let Some((old, _)) = old { old.store(true, Ordering::Relaxed) }
    let _ = shell;
    std::thread::spawn(move || {
        let told = |event: LiveEvent| {
            if !stop.load(Ordering::Relaxed) { let _ = post.send(Box::new(move |s| step(s, event))); }
        };
        let Ok(mut socket) = server.socket("/api/live/socket", &gtk::glib::uuid_string_random(), &session) else { return told(LiveEvent::SocketClosed) };
        told(LiveEvent::SocketOpened);
        while !stop.load(Ordering::Relaxed) {
            while let Ok(text) = rx.try_recv() {
                if socket.send(tungstenite::Message::text(text)).is_err() { return told(LiveEvent::SocketClosed) }
            }
            match socket.read() {
                Ok(tungstenite::Message::Text(t)) => if let Ok(m) = serde_json::from_str::<Value>(&t) { told(LiveEvent::Message { message: m }) },
                Ok(_) => {}
                Err(e) if net::timed_out(&e) => {}
                Err(_) => return told(LiveEvent::SocketClosed),
            }
        }
        let _ = socket.close(None);
    });
}
