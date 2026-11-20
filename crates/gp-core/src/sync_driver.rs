// When a device syncs, and what it does next (docs/rust-core.md, "Sync's client logic"): the web's SyncClient and its
// worker's loop (packages/sync/src/client/client.ts, apps/web/src/db/worker.ts) as one reducer every shell runs. The
// shell sends what happened (asked to sync, a poke, the socket opened or closed, a timer, the server's answer) with the
// state the core last gave it, and does what the core answers, in order: send this request, keep this page, rebase,
// open or close the poke socket, set a timer. A sync is push, then pull with every page, then the rebase; runs are
// coalesced, one running and one waiting; a refusal of the server's stops syncing and keeps the queue (SYNC-A15); the
// socket is opened again 3 s after it closes, and a poll every 5 minutes is the backstop (SYNC-R43).
use crate::args::*;
use crate::sync_wire::{pull_body, push_body, read, Answer, PROTOCOL_VERSION};
use serde_json::{json, Value};

/// How long after a closed or refused poke socket the next try waits, and the backstop poll.
const RECONNECT_MS: i64 = 3_000;
const POLL_MS: i64 = 5 * 60_000;

#[derive(Debug, Clone, Copy, PartialEq)]
enum Socket { Closed, Opening, Open }

#[derive(Debug, Clone, Copy, PartialEq)]
enum Phase { Idle, BeforePush, Push, Pull, Rebase }

/// Which halves a run does: a sync does both; a test may push or pull alone.
#[derive(Debug, Clone, Copy, PartialEq)]
struct Parts { push: bool, pull: bool }

impl Parts {
    fn or(self, o: Parts) -> Parts { Parts { push: self.push || o.push, pull: self.pull || o.pull } }
}

/// What the shell holds for the core between events.
#[derive(Debug, Clone, PartialEq)]
struct State {
    /// The protocol sent (an old app's, in a test) and whether the shell uploads first what a push needs (`beforePush`).
    protocol: i64,
    hooks: bool,
    /// Whether the socket and the poll are wanted (between `start` and `close`).
    started: bool,
    socket: Socket,
    stopped: Option<String>,
    busy: bool,
    phase: Phase,
    /// The current run's halves and number, and the run asked for meanwhile.
    parts: Parts,
    run: i64,
    again: Option<Parts>,
    /// After the runs: the media fetched (on a connection and a poll), and the socket tried again (after it failed).
    media: bool,
    reconnect: bool,
}

/// One thing for the shell to do, in order.
#[derive(Debug, Clone, PartialEq)]
enum Do {
    /// The run that will serve the event that asked for one.
    Queued(i64),
    BeforePush,
    /// A push of the queue (of its first `limit`); resolved into a request, or into `Event::NothingToPush`.
    Push(Option<usize>),
    /// A pull from the device's cookie, or from the one given.
    Pull(Option<Value>),
    KeepPage,
    Rebase,
    /// A run ended; `Idle` when none follows it.
    Ended { run: i64, error: Option<String> },
    Idle,
    Media,
    OpenSocket,
    CloseSocket,
    Timer(&'static str, i64),
    CancelTimers,
}

#[derive(Debug, Clone, PartialEq)]
enum Event {
    Sync { parts: Parts, media: bool },
    /// How many of the queue, from its front, the shell's uploads saw and let go: never "all", as a change queued
    /// while they ran names what was not uploaded (Lars, 2026-11-20: the server refused such a picture).
    PushLimit(usize),
    NothingToPush,
    Answer { status: i64, body: Value },
    Failed(String),
    Rebased,
    Start,
    Close,
    SocketOpened,
    Poke,
    SocketClosed,
    Timer(String),
}

fn fresh(protocol: i64, hooks: bool) -> State {
    State {
        protocol, hooks, started: false, socket: Socket::Closed, stopped: None, busy: false, phase: Phase::Idle,
        parts: Parts { push: true, pull: true }, run: 0, again: None, media: false, reconnect: false,
    }
}

const BOTH: Parts = Parts { push: true, pull: true };

/// The state after `ev`, and what to do.
fn step(st: &State, ev: &Event) -> (State, Vec<Do>) {
    let mut s = st.clone();
    let mut out = vec![];
    match ev {
        Event::Sync { parts, media } => sync(&mut s, &mut out, *parts, *media),
        Event::PushLimit(limit) if s.phase == Phase::BeforePush => {
            s.phase = Phase::Push;
            out.push(Do::Push(Some(*limit)));
        }
        Event::NothingToPush if s.phase == Phase::Push => after_push(&mut s, &mut out),
        Event::Answer { status, body } if matches!(s.phase, Phase::Push | Phase::Pull) => {
            let pushing = s.phase == Phase::Push;
            match read(if pushing { "push" } else { "pull" }, *status, body) {
                Answer::Stop(why) => {
                    stop(&mut s, &mut out, why);
                    end(&mut s, &mut out, None);
                }
                Answer::Failed(e) => end(&mut s, &mut out, Some(e)),
                Answer::Ok(_) if pushing => after_push(&mut s, &mut out),
                Answer::Ok(page) => {
                    out.push(Do::KeepPage);
                    if page["more"].as_bool() == Some(true) {
                        out.push(Do::Pull(Some(page["cookie"].clone())));
                    } else {
                        s.phase = Phase::Rebase;
                        out.push(Do::Rebase);
                    }
                }
            }
        }
        Event::Failed(e) if s.phase != Phase::Idle => end(&mut s, &mut out, Some(e.clone())),
        Event::Rebased if s.phase == Phase::Rebase => end(&mut s, &mut out, None),
        Event::Start if !s.started => {
            s.started = true;
            out.push(Do::Timer("poll", POLL_MS));
            open(&mut s, &mut out);
        }
        Event::Close => {
            s.started = false;
            s.reconnect = false;
            close(&mut s, &mut out);
            out.push(Do::CancelTimers);
        }
        Event::SocketOpened if s.socket == Socket::Opening => {
            s.socket = Socket::Open;
            sync(&mut s, &mut out, BOTH, true); // to catch up on what happened while disconnected
        }
        Event::Poke if s.socket == Socket::Open => sync(&mut s, &mut out, BOTH, false),
        Event::SocketClosed if s.socket == Socket::Open => {
            s.socket = Socket::Closed;
            if s.started && s.stopped.is_none() { out.push(Do::Timer("reconnect", RECONNECT_MS)) }
        }
        // A socket refused says nothing of why: a sync tells offline from refused credentials, and the socket is
        // tried again after it unless they were.
        Event::SocketClosed if s.socket == Socket::Opening => {
            s.socket = Socket::Closed;
            s.reconnect = true;
            sync(&mut s, &mut out, BOTH, false);
        }
        Event::Timer(name) if name == "reconnect" && s.started && s.socket == Socket::Closed => open(&mut s, &mut out),
        Event::Timer(name) if name == "poll" && s.started => {
            out.push(Do::Timer("poll", POLL_MS));
            sync(&mut s, &mut out, BOTH, true);
        }
        _ => {}
    }
    (s, out)
}

/// A run asked for: started now, or after the one running (coalesced); none while syncing is stopped.
fn sync(s: &mut State, out: &mut Vec<Do>, parts: Parts, media: bool) {
    s.media |= media;
    if s.busy {
        s.again = Some(s.again.map_or(parts, |p| p.or(parts)));
        out.push(Do::Queued(s.run + 1));
        return;
    }
    s.busy = true;
    s.run += 1;
    s.parts = parts;
    out.push(Do::Queued(s.run));
    begin(s, out);
}

fn begin(s: &mut State, out: &mut Vec<Do>) {
    if s.stopped.is_some() { return end(s, out, None) }
    if !s.parts.push { return after_push(s, out) }
    if s.hooks {
        s.phase = Phase::BeforePush;
        out.push(Do::BeforePush);
    } else {
        s.phase = Phase::Push;
        out.push(Do::Push(None));
    }
}

fn after_push(s: &mut State, out: &mut Vec<Do>) {
    if !s.parts.pull { return end(s, out, None) }
    s.phase = Phase::Pull;
    out.push(Do::Pull(None));
}

/// The run ended, well or with `error`: the next one asked for meanwhile begins, or the device is idle.
fn end(s: &mut State, out: &mut Vec<Do>, error: Option<String>) {
    out.push(Do::Ended { run: s.run, error });
    if let Some(parts) = s.again.take() {
        s.run += 1;
        s.parts = parts;
        return begin(s, out);
    }
    s.busy = false;
    s.phase = Phase::Idle;
    out.push(Do::Idle);
    if std::mem::take(&mut s.media) && s.stopped.is_none() { out.push(Do::Media) }
    if std::mem::take(&mut s.reconnect) && s.started && s.stopped.is_none() && s.socket == Socket::Closed {
        out.push(Do::Timer("reconnect", RECONNECT_MS));
    }
}

fn stop(s: &mut State, out: &mut Vec<Do>, why: String) {
    s.stopped = Some(why);
    close(s, out);
}

fn open(s: &mut State, out: &mut Vec<Do>) {
    if s.stopped.is_some() { return }
    s.socket = Socket::Opening;
    out.push(Do::OpenSocket);
}

fn close(s: &mut State, out: &mut Vec<Do>) {
    if s.socket != Socket::Closed { out.push(Do::CloseSocket) }
    s.socket = Socket::Closed;
}

// ------------------------------------------------------------ JSON

fn socket_name(s: Socket) -> &'static str {
    match s { Socket::Closed => "closed", Socket::Opening => "opening", Socket::Open => "open" }
}

fn phase_name(p: Phase) -> &'static str {
    match p { Phase::Idle => "idle", Phase::BeforePush => "beforePush", Phase::Push => "push", Phase::Pull => "pull", Phase::Rebase => "rebase" }
}

fn parts_json(p: Parts) -> Value { json!({ "push": p.push, "pull": p.pull }) }

fn parts_of(v: &Value) -> Option<Parts> {
    v.as_object().map(|o| Parts { push: o.get("push").and_then(Value::as_bool).unwrap_or(true), pull: o.get("pull").and_then(Value::as_bool).unwrap_or(true) })
}

/// The state as the shell holds it; `connected`, `busy` and `stopped` are what it shows.
fn state_json(s: &State) -> Value {
    json!({
        "protocol": s.protocol, "hooks": s.hooks, "started": s.started, "socket": socket_name(s.socket),
        "connected": s.socket == Socket::Open, "stopped": s.stopped, "busy": s.busy, "phase": phase_name(s.phase),
        "parts": parts_json(s.parts), "run": s.run, "again": s.again.map(parts_json), "media": s.media, "reconnect": s.reconnect,
    })
}

fn state_of(v: &Value) -> R<State> {
    let o = obj(v)?;
    let b = |k: &str| o.get(k).and_then(Value::as_bool).unwrap_or(false);
    let name = |k: &str| o.get(k).and_then(Value::as_str).unwrap_or("");
    Ok(State {
        protocol: o.get("protocol").and_then(Value::as_i64).unwrap_or(PROTOCOL_VERSION),
        hooks: b("hooks"),
        started: b("started"),
        socket: match name("socket") { "opening" => Socket::Opening, "open" => Socket::Open, _ => Socket::Closed },
        stopped: o.get("stopped").and_then(Value::as_str).map(String::from),
        busy: b("busy"),
        phase: match name("phase") { "beforePush" => Phase::BeforePush, "push" => Phase::Push, "pull" => Phase::Pull, "rebase" => Phase::Rebase, _ => Phase::Idle },
        parts: o.get("parts").and_then(parts_of).unwrap_or(BOTH),
        run: o.get("run").and_then(Value::as_i64).unwrap_or(0),
        again: o.get("again").and_then(parts_of),
        media: b("media"),
        reconnect: b("reconnect"),
    })
}

fn event_of(v: &Value) -> R<Event> {
    let o = obj(v)?;
    let b = |k: &str, d: bool| o.get(k).and_then(Value::as_bool).unwrap_or(d);
    Ok(match o.get("type").and_then(Value::as_str).ok_or("invalid-args")? {
        "sync" => Event::Sync { parts: Parts { push: b("push", true), pull: b("pull", true) }, media: b("media", false) },
        "pushLimit" => Event::PushLimit(o.get("limit").and_then(Value::as_u64).ok_or("invalid-args")? as usize),
        "answer" => {
            // The body as JSON, or (a native shell) its text, null when it is not JSON.
            let body = match o.get("text").and_then(Value::as_str) {
                Some(t) => serde_json::from_str(t).unwrap_or(Value::Null),
                None => o.get("body").cloned().unwrap_or(Value::Null),
            };
            Event::Answer { status: o.get("status").and_then(Value::as_i64).ok_or("invalid-args")?, body }
        }
        "failed" => Event::Failed(o.get("error").and_then(Value::as_str).unwrap_or("failed").to_string()),
        "rebased" => Event::Rebased,
        "start" => Event::Start,
        "close" => Event::Close,
        "socketOpened" => Event::SocketOpened,
        "poke" => Event::Poke,
        "socketClosed" => Event::SocketClosed,
        "timer" => Event::Timer(o.get("name").and_then(Value::as_str).unwrap_or("").to_string()),
        _ => return Err("invalid-args".into()),
    })
}

/// `syncStepView` {state, event}: the state after the event, and what the shell does, in order. Without a state, a
/// device's first: {protocol?, hooks?} of `init` (the event may be left out then). Each request comes as
/// {"type": "post", "path", "body"}, its body JSON's text.
pub async fn view(a: &Obj) -> R<Value> {
    let mut st = match a.get("state") {
        Some(v) if !v.is_null() => state_of(v)?,
        _ => {
            let init = a.get("init").and_then(Value::as_object).cloned().unwrap_or_default();
            fresh(init.get("protocol").and_then(Value::as_i64).unwrap_or(PROTOCOL_VERSION), init.get("hooks").and_then(Value::as_bool).unwrap_or(false))
        }
    };
    let mut todo: std::collections::VecDeque<Do> = match a.get("event") {
        Some(ev) => {
            let (next, out) = step(&st, &event_of(ev)?);
            st = next;
            out.into()
        }
        None => Default::default(),
    };
    let mut effects = vec![];
    while let Some(d) = todo.pop_front() {
        effects.push(match d {
            Do::Push(limit) => match push_body(st.protocol, limit).await {
                Some(body) => json!({ "type": "post", "path": "/api/sync/push", "body": body }),
                None => {
                    let (next, out) = step(&st, &Event::NothingToPush);
                    st = next;
                    for (i, d) in out.into_iter().enumerate() { todo.insert(i, d) }
                    continue;
                }
            },
            Do::Pull(cookie) => json!({ "type": "post", "path": "/api/sync/pull", "body": pull_body(st.protocol, cookie.as_ref()).await }),
            Do::Queued(run) => json!({ "type": "queued", "run": run }),
            Do::BeforePush => json!({ "type": "beforePush" }),
            Do::KeepPage => json!({ "type": "keepPage" }),
            Do::Rebase => json!({ "type": "rebase" }),
            Do::Ended { run, error } => json!({ "type": "ended", "run": run, "error": error }),
            Do::Idle => json!({ "type": "idle" }),
            Do::Media => json!({ "type": "media" }),
            Do::OpenSocket => json!({ "type": "openSocket" }),
            Do::CloseSocket => json!({ "type": "closeSocket" }),
            Do::Timer(name, ms) => json!({ "type": "timer", "name": name, "ms": ms }),
            Do::CancelTimers => json!({ "type": "cancelTimers" }),
        });
    }
    Ok(json!({ "state": state_json(&st), "effects": effects }))
}

#[cfg(test)]
#[path = "sync_driver_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "sync_driver_random.rs"]
mod random;
