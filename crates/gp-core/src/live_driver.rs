// A device's live socket as one reducer every shell runs (Lars, 2026-11-22: logic that is neither look nor platform is
// the core's), as `syncStepView` is for sync: the web's LiveLink, its owner (apps/web/src/live/owner.ts) and its
// RemoteControl (remote.ts). The shell sends what happened (signed in, the socket opened or closed, a message, a
// timer, the live state or an output changed, a change to send to a session elsewhere) with the state the core last
// gave it, and does what the core answers, in order: open or close the socket, send this message, set a timer, apply
// this change to its own live state, show this pointer of the session it drives. The socket and the timers are the
// shell's; what is reported, taken, switched off and shown is decided here.
use crate::args::*;
use serde_json::{json, Map, Value};

/// A ping every 20 s; nothing heard for 30 s and the socket is taken for dead (LIVE_PING_MS, LIVE_PONG_MS).
const PING_MS: i64 = 20_000;
const PONG_MS: i64 = 10_000;
/// How long a controller waits for the owner's echo before it warns once (spec 04 §2).
const CONFIRM_MS: i64 = 2_000;

/// The wait before the next connection after `attempt` failed ones (LIVE-R51, `liveReconnectDelay`).
fn reconnect_delay(attempt: i64) -> i64 { [0, 2000, 5000, 10_000].get(attempt as usize).copied().unwrap_or(30_000) }

fn strings(v: &Value) -> Vec<String> { v.as_array().into_iter().flatten().filter_map(|x| x.as_str().map(String::from)).collect() }
fn presenting(p: &Value) -> Option<&str> { p["presentationId"].as_str().filter(|s| !s.is_empty()) }

/// The state a device starts from: {sessionId, deviceName} of `init`.
fn fresh(init: &Obj) -> Value {
    json!({
        "sessionId": init.get("sessionId").cloned().unwrap_or(Value::Null),
        "deviceName": init.get("deviceName").cloned().unwrap_or(json!("")),
        "started": false, "connected": false, "attempt": 0, "heard": 0, "pinged": false, "lastSent": "",
        "remote": false, "chosen": [], "takeOver": [], "seen": [], "pointer": null, "audio": null, "video": null, "videoLive": null,
        "sessions": [], "online": [], "screens": [], "controllable": [], "control": null,
    })
}

struct Step { st: Value, out: Vec<Value>, now: i64 }

impl Step {
    fn put(&mut self, effect: Value) { self.out.push(effect) }
    fn send(&mut self, message: Value) { if self.st["connected"] == json!(true) { self.put(json!({ "type": "send", "message": message })) } }
    fn timer(&mut self, name: &str, ms: i64) { self.put(json!({ "type": "timer", "name": name, "ms": ms })) }
    fn chosen(&self) -> Vec<String> { strings(&self.st["chosen"]) }
    fn set_list(&mut self, k: &str, v: Vec<String>) { self.st[k] = json!(v) }

    /// An output switched; taking one from another presentation (asked first by the shell) with `take`.
    fn output(&mut self, id: &str, on: bool, take: bool) {
        let mut chosen = self.chosen();
        let mut taking = strings(&self.st["takeOver"]);
        chosen.retain(|x| x != id);
        taking.retain(|x| x != id);
        if on { chosen.push(id.into()) }
        if on && take { taking.push(id.into()) }
        self.set_list("chosen", chosen);
        self.set_list("takeOver", taking);
    }

    /// The whole state to the server while presenting (only what changed, LIVE-R47), the outputs' slide and canvas
    /// only while one is chosen (`liveSlideView`, `shownOnOutputsView`).
    async fn report(&mut self) {
        let p = self.st["pointer"].clone();
        let Some(pid) = presenting(&p).map(String::from) else { return };
        let outputs = !self.chosen().is_empty();
        let pick = |k: &str| if outputs { p[k].clone() } else { Value::Null };
        let ask = json!({ "presentationId": pid, "itemId": pick("itemId"), "partIndex": p["partIndex"].as_i64().unwrap_or(0), "overlayId": pick("overlayId") });
        let Ok(shown) = crate::live_views::slide(ask.as_object().unwrap_or(&Map::new())).await else { return };
        let (mut slide, mut canvas) = (Value::Null, Value::Null);
        if outputs {
            let args = json!({ "pointer": p, "shown": shown, "video": self.st["videoLive"], "now": self.now });
            if let Ok(out) = crate::live_report::view(args.as_object().unwrap_or(&Map::new())) { (slide, canvas) = (out["slide"].clone(), out["canvas"].clone()) }
        }
        let state = json!({
            "sessionId": self.st["sessionId"], "presentationId": pid, "presentationName": shown["name"].as_str().unwrap_or(""),
            "deviceName": self.st["deviceName"], "remote": self.st["remote"],
            "pointer": { "itemId": p["itemId"], "partIndex": p["partIndex"].as_i64().unwrap_or(0), "black": p["black"].as_bool().unwrap_or(false), "overlayId": p["overlayId"], "rev": p["rev"].as_i64().unwrap_or(0) },
            "outputs": self.st["chosen"], "takeOver": self.st["takeOver"], "slide": slide, "canvas": canvas,
            "audio": self.st["audio"], "video": self.st["video"],
        });
        let text = state.to_string();
        if self.st["lastSent"].as_str() == Some(&text) || self.st["connected"] != json!(true) { return }
        self.st["lastSent"] = json!(text);
        self.send(json!({ "type": "own", "state": state }));
    }

    /// The live state changed: reported; a session that stops presenting ends.
    async fn follow(&mut self, pointer: Value) {
        let was = presenting(&self.st["pointer"]).is_some();
        let now = presenting(&pointer).is_some();
        self.st["pointer"] = if now { pointer } else { Value::Null };
        if was && !now {
            let id = self.st["sessionId"].clone();
            self.send(json!({ "type": "end", "sessionId": id }));
            self.st["lastSent"] = json!("");
        }
        self.report().await;
    }

    /// A controller's command, taken if it still makes sense (LIVE-R49, `liveTargetsView`, `remoteTakeView`): the
    /// shell applies it to its own live state as its own change.
    async fn command(&mut self, change: &Value) {
        let p = self.st["pointer"].clone();
        let Some(pid) = presenting(&p) else { return };
        let ids = |k: &str| change[k].as_str().filter(|s| !s.is_empty()).map_or(Value::Null, |s| json!(s));
        let ask = json!({ "presentationId": pid, "itemId": ids("itemId"), "overlayId": ids("overlayId") });
        let Ok(there) = crate::live_views::targets(ask.as_object().unwrap_or(&Map::new())).await else { return };
        let args = json!({ "pointer": p, "command": change, "item": there["item"], "overlay": there["overlay"] });
        let take = crate::remote_control::take(args.as_object().unwrap_or(&Map::new())).map(|t| t["take"] == json!(true)).unwrap_or(false);
        if take { self.put(json!({ "type": "apply", "change": change })) }
    }

    /// The organisation's sessions listed anew: the outputs taken over settled; chosen screens that went away
    /// switched off (a saved screen whose page closed, LIVE-A20, a temporary one no longer paired; only one seen
    /// before); the session driven from here shown.
    async fn sessions(&mut self) {
        let me = self.st["sessionId"].clone();
        // The sessions elsewhere a member may drive (Visas just nu's Ta kontroll, LIVE-A27): remote control allowed,
        // the owner online, never this device's own.
        let controllable: Vec<Value> = self.st["sessions"].as_array().into_iter().flatten()
            .filter(|s| s["remote"] == json!(true) && s["ownerOnline"] != json!(false) && s["id"] != me).cloned().collect();
        self.st["controllable"] = json!(controllable);
        let mine: Vec<String> = self.st["sessions"].as_array().into_iter().flatten().filter(|s| s["id"] == me)
            .flat_map(|s| s["outputs"].as_array().cloned().unwrap_or_default()).filter_map(|o| o["id"].as_str().map(String::from)).collect();
        let taking: Vec<String> = strings(&self.st["takeOver"]).into_iter().filter(|id| !mine.contains(id)).collect();
        self.set_list("takeOver", taking);
        if !self.chosen().is_empty() {
            let saved: Vec<String> = crate::live_views::displays(&Map::new()).await.unwrap_or_default().as_array().into_iter().flatten()
                .filter(|d| d["kind"] == "screen").filter_map(|d| d["id"].as_str().map(String::from)).collect();
            let mut here: Vec<String> = strings(&self.st["online"]).into_iter().filter(|id| saved.contains(id)).collect();
            here.extend(self.st["screens"].as_array().into_iter().flatten().filter_map(|x| x["id"].as_str().map(String::from)));
            let mut seen = strings(&self.st["seen"]);
            let gone: Vec<String> = self.chosen().into_iter().filter(|id| seen.contains(id) && !here.contains(id)).collect();
            for id in &here { if !seen.contains(id) { seen.push(id.clone()) } }
            seen.retain(|id| !gone.contains(id));
            self.set_list("seen", seen);
            for id in &gone { self.output(id, false, false) }
            if !gone.is_empty() { self.report().await }
        }
        self.mirror();
    }

    /// The chosen outputs another session sends to, which this one did not ask to take over: let go after the
    /// server refused them (`output-taken`).
    async fn refused(&mut self) {
        let me = self.st["sessionId"].clone();
        let elsewhere: Vec<String> = self.st["sessions"].as_array().into_iter().flatten().filter(|s| s["id"] != me)
            .flat_map(|s| s["outputs"].as_array().cloned().unwrap_or_default()).filter_map(|o| o["id"].as_str().map(String::from)).collect();
        let taking = strings(&self.st["takeOver"]);
        for id in self.chosen().into_iter().filter(|id| elsewhere.contains(id) && !taking.contains(id)) { self.output(&id, false, false) }
        self.report().await;
    }

    /// What the session driven from here shows (`remotePointerView`): {pointer, confirmed}; none once it is gone.
    fn shown(&self) -> Option<Value> {
        let id = &self.st["control"]["sessionId"];
        let s = self.st["sessions"].as_array().into_iter().flatten().find(|s| &s["id"] == id)?;
        let args = json!({ "session": { "presentationId": s["presentationId"], "pointer": s["pointer"] }, "pending": self.st["control"]["pending"] });
        crate::remote_control::pointer(args.as_object()?).ok()
    }

    /// The session driven from here shown, the echo settling the pending command; or that it is gone.
    fn mirror(&mut self) {
        if self.st["control"].is_null() { return }
        let Some(shown) = self.shown() else {
            self.st["control"] = Value::Null;
            return self.put(json!({ "type": "lost" }));
        };
        if shown["confirmed"] == json!(true) { self.st["control"]["pending"] = Value::Null }
        self.put(json!({ "type": "mirror", "pointer": shown["pointer"] }));
    }

    /// A change of the page sent on to the session driven from here as the command its owner takes
    /// (`remoteCommandView`), shown at once; unconfirmed after 2 s, said once.
    fn set(&mut self, change: &Value) {
        if self.st["control"].is_null() { return }
        let Some(shown) = self.shown() else { return self.mirror() };
        let ask = json!({ "pointer": shown["pointer"], "change": change });
        let Ok(next) = crate::remote_control::command(ask.as_object().unwrap_or(&Map::new())) else { return };
        let id = self.st["control"]["sessionId"].clone();
        self.st["control"]["pending"] = next["command"].clone();
        self.send(json!({ "type": "set", "sessionId": id, "change": next["command"] }));
        self.timer("unconfirmed", CONFIRM_MS);
        self.mirror();
    }

    /// The 2 s after a command: not echoed, said once; the click shown no longer.
    fn unconfirmed(&mut self) {
        if self.st["control"].is_null() || self.st["control"]["pending"].is_null() { return }
        let confirmed = self.shown().is_some_and(|s| s["confirmed"] == json!(true));
        if !confirmed && self.st["control"]["warned"] != json!(true) {
            self.st["control"]["warned"] = json!(true);
            self.put(json!({ "type": "unconfirmed" }));
        }
        self.st["control"]["pending"] = Value::Null;
        self.mirror();
    }

    /// A message the server sent.
    async fn heard(&mut self, m: &Value) {
        self.st["heard"] = json!(self.now);
        self.st["pinged"] = json!(false);
        let me = self.st["sessionId"].clone();
        let presenting = presenting(&self.st["pointer"]).is_some();
        match m["type"].as_str() {
            Some("sessions") => {
                for k in ["sessions", "online", "screens"] { self.st[k] = m.get(k).cloned().unwrap_or(json!([])) }
                self.sessions().await;
            }
            Some("command") if m["sessionId"] == me => self.command(&m["change"]).await,
            Some("audio-command") if m["sessionId"] == me && presenting => self.put(json!({ "type": "audio", "command": m["command"] })),
            Some("video-command") if m["sessionId"] == me && presenting => self.put(json!({ "type": "video", "command": m["command"] })),
            Some("released") if m["sessionId"] == me => {
                for id in strings(&m["outputs"]) { self.output(&id, false, false) }
                self.report().await;
            }
            Some("pong" | "command" | "audio-command" | "video-command" | "released") => {}
            // A refused report is not what the server holds: the next one goes even if it is the same.
            _ if m["error"] == "invalid-message" => {}
            _ => {
                self.st["lastSent"] = json!("");
                if m["error"] == "output-taken" { self.refused().await }
            }
        }
    }
}

/// `liveStepView` {state, event} (or {init: {sessionId, deviceName}} first): the state after the event, and what the
/// shell does, in order. Events, each with `now` (ms): start, stop, socketOpened, socketClosed, message {message},
/// timer {name}, follow {pointer} (the live state, null when nothing is presented), remote {on}, output {id, on,
/// take}, playback {audio, video, videoLive}, changed (the data), control {sessionId}, release, set {change}. Effects:
/// openSocket, closeSocket, send {message}, timer {name, ms}, apply {change}, audio {command}, video {command},
/// mirror {pointer}, lost, unconfirmed.
pub async fn view(a: &Obj) -> R<Value> {
    let st = match a.get("state") {
        Some(v) if v.is_object() => v.clone(),
        _ => fresh(a.get("init").and_then(Value::as_object).unwrap_or(&Map::new())),
    };
    let Some(ev) = a.get("event").and_then(Value::as_object) else { return Ok(json!({ "state": st, "effects": [] })) };
    let mut s = Step { st, out: vec![], now: ev.get("now").and_then(Value::as_i64).unwrap_or(0) };
    let get = |k: &str| ev.get(k).cloned().unwrap_or(Value::Null);
    match ev.get("type").and_then(Value::as_str).ok_or("invalid-args")? {
        "start" => if s.st["started"] != json!(true) {
            s.st["started"] = json!(true);
            s.put(json!({ "type": "openSocket" }));
        },
        "stop" => {
            s.st["started"] = json!(false);
            s.st["connected"] = json!(false);
            s.put(json!({ "type": "closeSocket" }));
        }
        "socketOpened" => {
            for (k, v) in [("connected", json!(true)), ("attempt", json!(0)), ("heard", json!(s.now)), ("pinged", json!(false)), ("lastSent", json!(""))] { s.st[k] = v }
            s.timer("ping", PING_MS);
            // The whole state again on every reconnect (LIVE-R47).
            s.report().await;
        }
        "socketClosed" => {
            s.st["connected"] = json!(false);
            if s.st["started"] == json!(true) {
                let attempt = s.st["attempt"].as_i64().unwrap_or(0);
                s.st["attempt"] = json!(attempt + 1);
                s.timer("reconnect", reconnect_delay(attempt));
            }
        }
        "message" => s.heard(&get("message")).await,
        "timer" => match ev.get("name").and_then(Value::as_str) {
            Some("reconnect") if s.st["started"] == json!(true) && s.st["connected"] != json!(true) => s.put(json!({ "type": "openSocket" })),
            Some("ping") if s.st["connected"] == json!(true) => {
                if s.now - s.st["heard"].as_i64().unwrap_or(0) > PING_MS + PONG_MS { s.put(json!({ "type": "closeSocket" })) } else {
                    s.st["pinged"] = json!(true);
                    s.send(json!({ "type": "ping" }));
                    s.timer("ping", PING_MS);
                }
            }
            Some("unconfirmed") => s.unconfirmed(),
            _ => {}
        },
        "follow" => s.follow(get("pointer")).await,
        "remote" => { s.st["remote"] = json!(get("on") == json!(true)); s.report().await }
        "output" => {
            let id = ev.get("id").and_then(Value::as_str).ok_or("invalid-args")?.to_string();
            s.output(&id, get("on") == json!(true), get("take") == json!(true));
            s.report().await;
        }
        "playback" => { for k in ["audio", "video", "videoLive"] { s.st[k] = get(k) } s.report().await }
        "changed" => s.report().await,
        "control" => { s.st["control"] = json!({ "sessionId": get("sessionId"), "pending": null, "warned": false }); s.mirror() }
        "release" => s.st["control"] = Value::Null,
        "set" => s.set(&get("change")),
        _ => return Err("invalid-args".into()),
    }
    Ok(json!({ "state": s.st, "effects": s.out }))
}
