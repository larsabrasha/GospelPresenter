// How the sync stands, in words, and whether it is a problem (docs/layout-2-0.md, "The start page and the bar"): the
// web's syncState (apps/web/src/ui/syncState.ts at 37ac7481) for every shell, which each had its own and which had
// drifted apart. Changes waiting a moment after a save, or a page not yet connected after it loads, are no problem
// until they have waited `GRACE_MS` (Lars, 2026-11-05); the shell keeps that timer, the core says when it runs.
// Signed out, the bar only counts the changes that wait, and the notice says to sign in again (Lars, 2026-11-07).
use crate::args::*;
use serde_json::{json, Value};

/// How long changes may wait, or the device be without its connection, before it counts as a problem.
const GRACE_MS: i64 = 1_500;

/// The sync as the shell knows it: the driver's state (`syncStepView`) and the changes queued.
#[derive(Debug, Clone, PartialEq)]
struct Sync { pending: i64, stopped: Option<String>, connected: bool, busy: bool }

/// A text, by its code: each shell has the words (`status.<code>` in apps/web/src/i18n.ts).
#[derive(Debug, Clone, PartialEq)]
enum Text { Idle, Syncing, Offline, Error, AuthNeeded, Pending(i64) }

impl Text {
    fn json(&self) -> Value {
        match self {
            Text::Idle => json!({ "code": "idle" }),
            Text::Syncing => json!({ "code": "syncing" }),
            Text::Offline => json!({ "code": "offline" }),
            Text::Error => json!({ "code": "error" }),
            Text::AuthNeeded => json!({ "code": "authNeeded" }),
            Text::Pending(1) => json!({ "code": "pendingOne" }),
            Text::Pending(n) => json!({ "code": "pending", "n": n }),
        }
    }
}

/// What the bar and the menu say, whether it is a problem, and whether the grace's timer should run.
fn status(s: &Sync, waited_long: bool) -> (bool, Vec<Text>) {
    let pending = (s.pending > 0).then_some(Text::Pending(s.pending));
    if s.stopped.as_deref().is_some_and(|r| r != "update-required") {
        return match pending { Some(p) => (true, vec![p]), None => (false, vec![Text::AuthNeeded]) };
    }
    let offline = !s.connected && waited_long;
    let problem = if s.stopped.is_some() { Some(Text::Error) } else if offline { Some(Text::Offline) } else { None };
    if let Some(p) = problem { return (true, [Some(p), pending].into_iter().flatten().collect()) }
    if let Some(p) = pending.filter(|_| waited_long) { return (true, vec![p]) }
    (false, vec![if s.busy || s.pending > 0 || !s.connected { Text::Syncing } else { Text::Idle }])
}

/// What needs the person's attention until it is dealt with, and what puts it right: an update, pairing again, or
/// signing in again.
fn notice(s: &Sync) -> Value {
    match s.stopped.as_deref() {
        Some("update-required") => json!({ "code": "updateRequired", "action": null }),
        Some("device-not-paired") => json!({ "code": "notPaired", "action": "pairAgain" }),
        Some(_) => json!({ "code": "authRequired", "action": "signIn" }),
        None => Value::Null,
    }
}

/// `syncStatusView` {pending, stopped, connected, busy, waitedLong}: {problem, texts, notice, waiting, graceMs}. The
/// texts are shown joined by " · "; `waiting` says the grace applies, so the shell asks again with `waitedLong` once
/// it has held for `graceMs`.
pub fn view(a: &Obj) -> R<Value> {
    let s = Sync {
        pending: a.get("pending").and_then(Value::as_i64).unwrap_or(0),
        stopped: a.get("stopped").and_then(Value::as_str).map(String::from),
        connected: a.get("connected").and_then(Value::as_bool).unwrap_or(false),
        busy: a.get("busy").and_then(Value::as_bool).unwrap_or(false),
    };
    let (problem, texts) = status(&s, a.get("waitedLong").and_then(Value::as_bool).unwrap_or(false));
    Ok(json!({
        "problem": problem,
        "texts": texts.iter().map(Text::json).collect::<Vec<_>>(),
        "notice": notice(&s),
        "waiting": s.pending > 0 || !s.connected,
        "graceMs": GRACE_MS,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn synced() -> Sync { Sync { pending: 0, stopped: None, connected: true, busy: false } }

    #[test]
    fn a_page_not_yet_connected_is_no_problem_yet() {
        assert_eq!(status(&Sync { connected: false, ..synced() }, false), (false, vec![Text::Syncing]));
    }

    #[test]
    fn a_synced_device_has_no_problem_and_says_so() {
        assert_eq!(status(&synced(), false), (false, vec![Text::Idle]));
    }

    #[test]
    fn changes_waiting_a_moment_after_a_save_are_no_problem_yet() {
        assert_eq!(status(&Sync { pending: 2, ..synced() }, false), (false, vec![Text::Syncing]));
    }

    #[test]
    fn changes_that_have_waited_past_the_grace_are_a_problem_with_their_number() {
        assert_eq!(status(&Sync { pending: 3, ..synced() }, true), (true, vec![Text::Pending(3)]));
    }

    #[test]
    fn offline_past_the_grace_is_a_problem_with_the_changes_that_wait() {
        assert_eq!(status(&Sync { connected: false, pending: 3, ..synced() }, true), (true, vec![Text::Offline, Text::Pending(3)]));
    }

    #[test]
    fn one_change_waiting_is_said_in_the_singular() {
        assert_eq!(Text::Pending(1).json(), json!({ "code": "pendingOne" }));
    }

    #[test]
    fn signed_out_only_the_changes_that_wait_are_counted() {
        let s = Sync { connected: false, stopped: Some("unauthenticated".into()), pending: 2, ..synced() };

        assert_eq!(status(&s, false), (true, vec![Text::Pending(2)]));
    }

    #[test]
    fn signed_out_with_nothing_waiting_is_no_problem_for_the_bar() {
        let s = Sync { connected: false, stopped: Some("unauthenticated".into()), ..synced() };

        assert_eq!(status(&s, true), (false, vec![Text::AuthNeeded]));
    }

    #[test]
    fn an_update_the_server_needs_is_a_problem_at_once() {
        let s = Sync { stopped: Some("update-required".into()), ..synced() };

        assert_eq!(status(&s, false), (true, vec![Text::Error]));
    }

    #[test]
    fn an_unpaired_device_is_asked_to_pair_again() {
        let s = Sync { stopped: Some("device-not-paired".into()), ..synced() };

        assert_eq!(notice(&s), json!({ "code": "notPaired", "action": "pairAgain" }));
    }

    #[test]
    fn a_removed_member_is_asked_to_sign_in_again() {
        let s = Sync { stopped: Some("not-a-member".into()), ..synced() };

        assert_eq!(notice(&s), json!({ "code": "authRequired", "action": "signIn" }));
    }
}
