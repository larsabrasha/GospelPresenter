// "Anslut tillfällig skärm" as one reducer every shell runs (the web's PairScreenDialog, LIVE-R28; Lars, 2026-11-22: a
// flow with a state of its own is the core's): a QR token made on open and renewed every eight minutes, the server
// asked every two seconds whether a TV used it, the token dropped on close (a TV that used it meanwhile is taken in all
// the same), and the four digits a TV shows claimed instead; a screen paired is switched on for the session, and a
// wrong code empties the boxes. The shell does the requests, as the signed-in device, and the timers.
use crate::args::*;
use crate::view_types::{LiveScreen, PairEffect as Do, PairEvent as E, PairState, PairStep};
use serde_json::{json, Map, Value};

/// A token is renewed after eight minutes; whether a TV used it is asked every two seconds.
const RENEW_MS: i64 = 8 * 60_000;
const POLL_MS: i64 = 2_000;

struct Step { st: PairState, out: Vec<Do> }

impl Step {
    fn request(&mut self, request: &str, token: Option<String>, method: &str, path: String, body: Option<Value>) {
        self.out.push(Do::Request { request: request.into(), token, method: method.into(), path, body });
    }
    fn timer(&mut self, name: &str, ms: i64) { self.out.push(Do::Timer { name: name.into(), ms }) }
    fn session(&self) -> String { self.st.session_id.replace('&', "%26").replace('?', "%3F").replace('#', "%23") }

    /// A new token asked for.
    fn make(&mut self) { self.request("make", None, "POST", "/api/live/screens/token".into(), None) }

    /// A token let go; a TV that used it meanwhile comes back in the answer.
    fn drop_token(&mut self, token: String) {
        let path = format!("/api/live/screens/token/{token}?session={}", self.session());
        self.request("drop", Some(token), "DELETE", path, None);
    }

    /// A screen the server took in for the session: switched on; with the dialog open, said so, and the asking ends.
    fn took(&mut self, screen: Value) {
        let Ok(screen) = serde_json::from_value::<LiveScreen>(screen) else { return };
        self.out.push(Do::Output { id: screen.id.clone() });
        if self.st.stopped || self.st.paired.is_some() { return }
        self.st.paired = Some(screen);
        self.end();
    }

    /// The asking stopped: the timers, and the token let go.
    fn end(&mut self) {
        self.out.push(Do::CancelTimers);
        if let Some(t) = self.st.token.take() { self.drop_token(t) }
    }

    fn event(&mut self, e: E) {
        match e {
            E::Open => {
                self.make();
                self.timer("renew", RENEW_MS);
                self.timer("poll", POLL_MS);
            }
            E::Timer { name } if self.st.paired.is_none() && !self.st.stopped => match name.as_str() {
                "renew" => { self.make(); self.timer("renew", RENEW_MS) }
                "poll" => {
                    if let Some(t) = self.st.token.clone() {
                        let path = format!("/api/live/screens/token/{t}?session={}", self.session());
                        self.request("poll", Some(t), "GET", path, None);
                    }
                    self.timer("poll", POLL_MS);
                }
                _ => {}
            },
            E::Timer { .. } => {}
            E::Answer { request, token, body } => match request.as_str() {
                "make" => {
                    let Some(made) = body["token"].as_str().map(String::from) else { return };
                    // Made after the dialog closed or a screen came: let go at once.
                    if self.st.stopped || self.st.paired.is_some() { return self.drop_token(made) }
                    if let Some(old) = self.st.token.replace(made) { self.drop_token(old) }
                }
                "poll" => {
                    if body["screen"].is_object() {
                        // Used: nothing to let go.
                        if self.st.token == token { self.st.token = None }
                        self.took(body["screen"].clone());
                    }
                }
                "drop" => if body["screen"].is_object() { self.took(body["screen"].clone()) },
                "claim" => {
                    self.st.busy = false;
                    if body["screen"].is_object() { self.took(body["screen"].clone()) } else { self.st.wrong += 1 }
                }
                _ => {}
            },
            E::Submit { pin } => {
                if self.st.busy || self.st.paired.is_some() { return }
                self.st.busy = true;
                let body = json!({ "pin": pin, "sessionId": self.st.session_id });
                self.request("claim", None, "POST", "/api/live/screens/claim".into(), Some(body));
            }
            E::Close => {
                if self.st.stopped { return }
                self.st.stopped = true;
                self.end();
            }
        }
    }
}

/// `pairScreenStepView` {state, event} (or {init: {sessionId, base}} first): the dialog after the event, the link
/// its QR code shows and the display page's address, and what the shell does, in order (`PairStep`; `PairEvent` and
/// `PairEffect` of view_types.rs).
pub fn view(a: &Obj) -> R<Value> {
    let st = match a.get("state") {
        Some(v) if v.is_object() => serde_json::from_value(v.clone()).map_err(|_| "invalid-args".to_string())?,
        _ => {
            let init = a.get("init").and_then(Value::as_object).cloned().unwrap_or_else(Map::new);
            let text = |k: &str| init.get(k).and_then(Value::as_str).map(String::from);
            PairState { session_id: text("sessionId").ok_or("invalid-args")?, base: text("base").unwrap_or_default(), ..PairState::default() }
        }
    };
    let mut s = Step { st, out: vec![] };
    if let Some(raw) = a.get("event") { s.event(serde_json::from_value::<E>(raw.clone()).map_err(|_| "invalid-args".to_string())?) }
    let base = s.st.base.trim_end_matches('/').to_string();
    let link = s.st.token.as_ref().map(|t| format!("{base}/display?token={t}"));
    serde_json::to_value(PairStep { link, address: format!("{base}/display"), state: s.st, effects: s.out }).map_err(|e| e.to_string())
}

#[cfg(test)]
#[path = "pair_screen_tests.rs"]
mod tests;
