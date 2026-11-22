// The device's live socket (`/api/live/socket`), as the Mac app's LiveStatus.swift: who is online and who watches, for
// Utgångar; this device as its live session's owner while it presents; a session elsewhere driven from here (Ta
// kontroll). What is reported, which command is taken, which outputs are let go, what a controller shows, when to ping
// and when to connect again are the core's (`liveStepView`); this does what it says: the socket on a thread of its
// own, the timers, and the app's live state changed or shown.
use crate::net::{self, Server, Session};
use crate::shell::Shell;
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
    /// The core's state (crates/gp-core/src/live_driver.rs), given back with each event.
    pub state: Value,
    timers: HashMap<String, gtk::glib::SourceId>,
    /// The socket's thread runs while this is false; messages to send go through `out`.
    socket: Option<(Arc<AtomicBool>, Sender<String>)>,
}

impl Live {
    pub fn session_id(&self) -> &str { self.state["sessionId"].as_str().unwrap_or("") }
    pub fn list(&self, k: &str) -> Value { self.state[k].clone() }
    pub fn remote(&self) -> bool { self.state["remote"].as_bool().unwrap_or(false) }
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
    let state = shell.model.borrow().app.core().call("liveStepView", init).map(|v| v["state"].clone()).unwrap_or_default();
    LIVE.with(|l| *l.borrow_mut() = Some(Live { server, session: session.clone(), state, timers: HashMap::new(), socket: None }));
    step(shell, json!({ "type": "start" }));
}

/// Signed out: the socket closed and forgotten.
pub fn stop(shell: &Rc<Shell>) {
    step(shell, json!({ "type": "stop" }));
    if let Some(l) = LIVE.with(|l| l.borrow_mut().take()) { for (_, t) in l.timers { t.remove() } }
}

/// Reads the live socket's state, if signed in.
pub fn with<T>(f: impl FnOnce(&Live) -> T) -> Option<T> { LIVE.with(|l| l.borrow().as_ref().map(f)) }

/// Gives the core an event with the state it last gave, and does what it answers, in order.
pub fn step(shell: &Rc<Shell>, mut event: Value) {
    let Some(state) = with(|l| l.state.clone()) else { return };
    event["now"] = json!(now());
    let out = shell.model.borrow().app.core().call("liveStepView", json!({ "state": state, "event": event }));
    let Ok(out) = out else { return };
    // What the pages show of it: the outputs, the sessions to drive, the connection.
    let shown = |s: &Value| ["sessions", "online", "screens", "chosen", "remote", "controllable"].map(|k| s[k].clone());
    let listed = shown(&state) != shown(&out["state"]);
    LIVE.with(|l| if let Some(l) = l.borrow_mut().as_mut() { l.state = out["state"].clone() });
    for effect in out["effects"].as_array().into_iter().flatten() { perform(shell, effect) }
    if listed { shell.live_listed() }
}

fn perform(shell: &Rc<Shell>, effect: &Value) {
    match effect["type"].as_str() {
        Some("openSocket") => open(shell),
        Some("closeSocket") => {
            if let Some((stop, _)) = LIVE.with(|l| l.borrow_mut().as_mut().and_then(|l| l.socket.take())) { stop.store(true, Ordering::Relaxed) }
            step(shell, json!({ "type": "socketClosed" }));
        }
        Some("send") => {
            let tx = LIVE.with(|l| l.borrow().as_ref().and_then(|l| l.socket.as_ref().map(|s| s.1.clone())));
            if let Some(tx) = tx { let _ = tx.send(effect["message"].to_string()); }
        }
        Some("timer") => {
            let (Some(name), Some(ms)) = (effect["name"].as_str().map(String::from), effect["ms"].as_u64()) else { return };
            let (weak, fired) = (Rc::downgrade(shell), name.clone());
            let id = gtk::glib::timeout_add_local_once(std::time::Duration::from_millis(ms), move || {
                LIVE.with(|l| if let Some(l) = l.borrow_mut().as_mut() { l.timers.remove(&fired); });
                if let Some(s) = weak.upgrade() { step(&s, json!({ "type": "timer", "name": fired })) }
            });
            let old = LIVE.with(|l| l.borrow_mut().as_mut().and_then(|l| l.timers.insert(name, id)));
            if let Some(old) = old { old.remove() }
        }
        Some("apply") => shell.live_apply(effect["change"].clone()),
        Some("mirror") => if let Ok(p) = serde_json::from_value::<LivePointer>(effect["pointer"].clone()) { shell.live_mirror(p) },
        Some("lost") => shell.stop_controlling(),
        Some("unconfirmed") => shell.remote_unconfirmed(),
        // audio and video commands: the Linux app plays no media yet (docs/native-parity.md).
        _ => {}
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
        let told = |event: Value| {
            if !stop.load(Ordering::Relaxed) { let _ = post.send(Box::new(move |s| step(s, event))); }
        };
        let Ok(mut socket) = server.socket("/api/live/socket", &gtk::glib::uuid_string_random(), &session) else { return told(json!({ "type": "socketClosed" })) };
        told(json!({ "type": "socketOpened" }));
        while !stop.load(Ordering::Relaxed) {
            while let Ok(text) = rx.try_recv() {
                if socket.send(tungstenite::Message::text(text)).is_err() { return told(json!({ "type": "socketClosed" })) }
            }
            match socket.read() {
                Ok(tungstenite::Message::Text(t)) => if let Ok(m) = serde_json::from_str::<Value>(&t) { told(json!({ "type": "message", "message": m })) },
                Ok(_) => {}
                Err(e) if net::timed_out(&e) => {}
                Err(_) => return told(json!({ "type": "socketClosed" })),
            }
        }
        let _ = socket.close(None);
    });
}
