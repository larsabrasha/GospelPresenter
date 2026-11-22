// A device's view of one organisation, as the Mac app's Sync.swift and the web's SyncClient: the queue, the rebase, the
// requests, the reading of the server's answers and when to sync are the Rust core's (`syncOpen`, `syncMutate`,
// `syncRebase` and the driver `syncStepView`); this is the shell that does what it says: the network on threads of
// its own, the poke socket and the timers. What a thread learns comes back to the window through `post`.
use crate::net::{self, Server, Session};
use crate::shell::Shell;
use gp_tui::app::App;
use gp_tui::dates::local_today;
use gp_tui::shell::{Caller, Core};
use gp_tui::texts::t;
use serde_json::{json, Value};
use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::Arc;

/// Work a thread hands back to the window, done there with the shell.
type Job = Box<dyn FnOnce(&Rc<Shell>) + Send>;

thread_local! {
    static POST: RefCell<Option<Sender<Job>>> = const { RefCell::new(None) };
}

/// Where threads send their answers: drained on the window's main loop every 30 ms.
pub fn listen(shell: &Rc<Shell>) {
    let (tx, rx) = channel::<Job>();
    POST.with(|p| *p.borrow_mut() = Some(tx));
    let weak = Rc::downgrade(shell);
    gtk::glib::timeout_add_local(std::time::Duration::from_millis(30), move || {
        let Some(s) = weak.upgrade() else { return gtk::glib::ControlFlow::Break };
        while let Ok(job) = rx.try_recv() { job(&s) }
        gtk::glib::ControlFlow::Continue
    });
}

/// A sender for a thread to hand work back to the window with.
pub fn poster() -> Option<Sender<Job>> { POST.with(|p| p.borrow().clone()) }

/// What to do with a thread's answer, kept in the window by its number: it holds widgets, which stay on their thread.
type Then = Box<dyn FnOnce(&Rc<Shell>, Box<dyn std::any::Any + Send>)>;

thread_local! {
    static WAITING: RefCell<(u64, HashMap<u64, Then>)> = RefCell::new((0, HashMap::new()));
}

/// Work done on a thread of its own, its answer done in the window.
pub fn in_background<T: Send + 'static>(work: impl FnOnce() -> T + Send + 'static, then: impl FnOnce(&Rc<Shell>, T) + 'static) {
    let Some(tx) = poster() else { return };
    let id = WAITING.with(|w| {
        let mut w = w.borrow_mut();
        w.0 += 1;
        let id = w.0;
        let then: Then = Box::new(move |s, out| if let Ok(out) = out.downcast::<T>() { then(s, *out) });
        w.1.insert(id, then);
        id
    });
    std::thread::spawn(move || {
        let out: Box<dyn std::any::Any + Send> = Box::new(work());
        let _ = tx.send(Box::new(move |s| {
            let then = WAITING.with(|w| w.borrow_mut().1.remove(&id));
            if let Some(then) = then { then(s, out) }
        }));
    });
}

pub struct Sync {
    pub session: Session,
    server: Server,
    client_id: String,
    /// The core's sync driver's state (crates/gp-core/src/sync_driver.rs), given back with each event.
    state: Value,
    /// The pages of the pull under way, as the server sent them, until the rebase.
    pages: Vec<String>,
    timers: HashMap<String, gtk::glib::SourceId>,
    /// The poke socket's thread runs while this is false.
    socket: Option<Arc<AtomicBool>>,
}

impl Sync {
    pub fn stopped(&self) -> Option<String> { self.state["stopped"].as_str().map(String::from) }
    pub fn connected(&self) -> bool { self.state["connected"].as_bool().unwrap_or(false) }
}

/// The organisation's database opened for `session` (data_dir/org-{id}.sqlite, migrated, sync's tables made), every
/// change queued for the server from now on; the window's App over it, and syncing started.
pub fn open(shell: &Rc<Shell>, session: Session) -> Result<(), String> {
    let server = Server::new(&session.server)?;
    let path = net::data_dir().join(format!("org-{}.sqlite", session.me.org_id));
    let core = Core::open(&path.to_string_lossy(), Caller { user_id: session.me.user_id.clone(), role: session.me.role.clone() })?;
    let opened = core.command("syncOpen", json!({ "clientId": gtk::glib::uuid_string_random().to_string() }))?;
    core.queue_changes()?;
    // After every change, a sync, as the web's worker syncs after each (posted: the change runs inside the model).
    let tx = poster();
    core.on_change(Box::new(move || if let Some(tx) = &tx { let _ = tx.send(Box::new(request)); }));
    // `hooks` false: the Linux app imports nothing, so no file or Bible text of its own waits to go up first.
    let state = core.call("syncStepView", json!({ "init": { "hooks": false } }))?["state"].clone();
    let client_id = opened["clientId"].as_str().unwrap_or_default().to_string();
    {
        let mut m = shell.model.borrow_mut();
        m.app = App::new(core, local_today());
        m.forget();
    }
    net::save_session(Some(&session));
    *shell.sync.borrow_mut() = Some(Sync { session, server, client_id, state, pages: vec![], timers: HashMap::new(), socket: None });
    send(shell, json!({ "type": "start" }), None);
    Ok(())
}

/// A sync, coalesced with the one running: push, then pull every page, then the rebase.
pub fn request(shell: &Rc<Shell>) { send(shell, json!({ "type": "sync" }), None) }

/// Signed out: the socket and the timers ended, the session forgotten (its database stays, as the Mac's does).
pub fn close(shell: &Rc<Shell>) {
    send(shell, json!({ "type": "close" }), None);
    if let Some(s) = shell.sync.borrow_mut().take() {
        if let Some(stop) = s.socket { stop.store(true, Ordering::Relaxed) }
        for (_, t) in s.timers { t.remove() }
    }
    net::save_session(None);
}

/// Gives the core an event with the state it last gave, and does what it answers, in order. `page` is the text of the
/// answer the event carries, kept when the core says so.
fn send(shell: &Rc<Shell>, event: Value, page: Option<String>) {
    let Some(state) = shell.sync.borrow().as_ref().map(|s| s.state.clone()) else { return };
    let step = shell.model.borrow().app.core().call("syncStepView", json!({ "state": state, "event": event }));
    let Ok(step) = step else { return };
    let before = status(shell);
    if let Some(s) = shell.sync.borrow_mut().as_mut() { s.state = step["state"].clone() }
    for effect in step["effects"].as_array().into_iter().flatten() { perform(shell, effect, page.as_deref()) }
    if status(shell) != before { shell.sync_status() }
}

fn status(shell: &Rc<Shell>) -> Option<(bool, Option<String>)> { shell.sync.borrow().as_ref().map(|s| (s.connected(), s.stopped())) }

fn perform(shell: &Rc<Shell>, effect: &Value, page: Option<&str>) {
    match effect["type"].as_str() {
        Some("post") => {
            let Some((server, session)) = shell.sync.borrow().as_ref().map(|s| (s.server.clone(), s.session.clone())) else { return };
            let (path, body) = (effect["path"].as_str().unwrap_or_default().to_string(), effect["body"].as_str().unwrap_or_default().to_string());
            in_background(move || server.request("POST", &path, Some(&body), Some(&session)), |s, answer| match answer {
                Ok((status, text)) => {
                    // What the driver reads of it (a refusal's error, a page's cookie and more), not the page itself,
                    // which may be megabytes and is kept here for the rebase.
                    let body: Value = serde_json::from_str(&text).unwrap_or_default();
                    let head = json!({ "error": body.get("error"), "cookie": body.get("cookie"), "more": body.get("more") });
                    send(s, json!({ "type": "answer", "status": status, "body": head }), Some(text));
                }
                Err(net::Failure::Untrusted(u)) => send(s, json!({ "type": "failed", "error": format!("untrusted {}", u.host) }), None),
                // Offline: the next poke or poll tries again.
                Err(net::Failure::Unreachable(e)) => send(s, json!({ "type": "failed", "error": e }), None),
            });
        }
        Some("keepPage") => if let (Some(p), Some(s)) = (page, shell.sync.borrow_mut().as_mut()) { s.pages.push(p.to_string()) },
        Some("rebase") => {
            let pages = shell.sync.borrow_mut().as_mut().map(|s| std::mem::take(&mut s.pages)).unwrap_or_default();
            // Not within this step: the core hears it is done as an event of its own.
            if let Some(tx) = poster() { let _ = tx.send(Box::new(move |s| rebase(s, pages))); }
        }
        Some("ended") => if let Some(s) = shell.sync.borrow_mut().as_mut() { s.pages.clear() },
        Some("openSocket") => listen_pokes(shell),
        Some("closeSocket") => if let Some(stop) = shell.sync.borrow_mut().as_mut().and_then(|s| s.socket.take()) { stop.store(true, Ordering::Relaxed) },
        Some("timer") => {
            let (Some(name), Some(ms)) = (effect["name"].as_str().map(String::from), effect["ms"].as_u64()) else { return };
            let weak = Rc::downgrade(shell);
            let fired = name.clone();
            let id = gtk::glib::timeout_add_local_once(std::time::Duration::from_millis(ms), move || {
                let Some(s) = weak.upgrade() else { return };
                if let Some(sync) = s.sync.borrow_mut().as_mut() { sync.timers.remove(&fired); }
                send(&s, json!({ "type": "timer", "name": fired }), None);
            });
            if let Some(old) = shell.sync.borrow_mut().as_mut().and_then(|s| s.timers.insert(name, id)) { old.remove() }
        }
        Some("cancelTimers") => if let Some(s) = shell.sync.borrow_mut().as_mut() { for (_, t) in s.timers.drain() { t.remove() } },
        // media: the Linux app fetches no files yet (docs/native-parity.md); queued, idle: nothing to do.
        _ => {}
    }
}

/// The queue rebased onto the pages, in one transaction; the window shows what changed; the core hears it is done, or
/// that it failed.
fn rebase(shell: &Rc<Shell>, pages: Vec<String>) {
    let pages: Vec<Value> = pages.iter().filter_map(|p| serde_json::from_str(p).ok()).collect();
    let rebased = shell.model.borrow().app.core().command("syncRebase", json!({ "pages": pages }));
    match rebased {
        Ok(r) => {
            for refused in r["results"].as_array().into_iter().flatten() { eprintln!("gospel-presenter: the server refused a change: {refused}") }
            if r["changed"].as_bool() == Some(true) { shell.pulled() }
            send(shell, json!({ "type": "rebased" }), None);
        }
        Err(e) => send(shell, json!({ "type": "failed", "error": e }), None),
    }
}

/// One connection of the poke socket, on a thread: its opening, each poke and its closing (a refused one too) told to
/// the core. Stopped by its flag within a second.
fn listen_pokes(shell: &Rc<Shell>) {
    let Some((server, session, client_id)) = shell.sync.borrow().as_ref().map(|s| (s.server.clone(), s.session.clone(), s.client_id.clone())) else { return };
    let Some(tx) = poster() else { return };
    let stop = Arc::new(AtomicBool::new(false));
    if let Some(old) = shell.sync.borrow_mut().as_mut().and_then(|s| s.socket.replace(stop.clone())) { old.store(true, Ordering::Relaxed) }
    std::thread::spawn(move || {
        let told = |stop: &AtomicBool, event: Value| {
            if !stop.load(Ordering::Relaxed) { let _ = tx.send(Box::new(move |s| send(s, event, None))); }
        };
        let Ok(mut socket) = server.socket("/api/sync/poke", &client_id, &session) else { return told(&stop, json!({ "type": "socketClosed" })) };
        told(&stop, json!({ "type": "socketOpened" }));
        while !stop.load(Ordering::Relaxed) {
            match socket.read() {
                Ok(tungstenite::Message::Text(_) | tungstenite::Message::Binary(_)) => told(&stop, json!({ "type": "poke" })),
                Ok(_) => {}
                Err(e) if net::timed_out(&e) => {}
                Err(_) => return told(&stop, json!({ "type": "socketClosed" })),
            }
        }
        let _ = socket.close(None);
    });
}

/// The sync's problem as the person reads it (the core's `syncStatusView`, as the Mac's noteSync): a notice, or what
/// waits and why; none while all is well.
pub fn problem(shell: &Rc<Shell>) -> Option<String> {
    let (connected, stopped, busy) = shell.sync.borrow().as_ref().map(|s| (s.connected(), s.stopped(), s.state["busy"].as_bool().unwrap_or(false)))?;
    let m = shell.model.borrow();
    let core = m.app.core();
    let pending = core.call("syncPending", json!({})).ok().and_then(|v| v.as_array().map(Vec::len)).unwrap_or(0);
    let args = json!({ "pending": pending, "stopped": stopped, "connected": connected, "busy": busy, "waitedLong": false });
    let s = core.call("syncStatusView", args).ok()?;
    if let Some(code) = s["notice"]["code"].as_str() { return Some(t(&format!("status.{code}"), &[])) }
    if s["problem"].as_bool() != Some(true) { return None }
    let texts: Vec<String> = s["texts"].as_array().into_iter().flatten().map(|x| {
        let code = x["code"].as_str().unwrap_or_default();
        if code == "pending" { t("status.pending", &[("n", &x["n"].as_i64().unwrap_or(0).to_string())]) } else { t(&format!("status.{code}"), &[]) }
    }).collect();
    Some(texts.join(" · "))
}
