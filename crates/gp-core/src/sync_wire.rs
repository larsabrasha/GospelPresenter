// Sync's wire, the client's half (packages/core/src/protocol.ts): the push and pull requests a device sends, read from
// its queue and `_sync_meta`, and what an answer of the server's means: a page, a refusal that stops syncing until the
// person acts (SYNC-A15, SYNC-R35), or a failure the next try repeats. The shell only sends and receives the text.
use crate::bridge::sql;
use crate::mutators::{first, int_of, s};
use crate::schema::SCHEMA_VERSION;
use serde_json::{json, Value};

/// The protocol this core speaks (`PROTOCOL_VERSION`); a test gives an older one to play an old app.
pub const PROTOCOL_VERSION: i64 = 1;
/// The refusals of credentials that stop syncing (401 or 403 with one of them as `error`).
const SIGNED_OUT: [&str; 3] = ["unauthenticated", "not-a-member", "device-not-paired"];

/// JSON's text of a string.
fn text(v: &str) -> String { Value::String(v.into()).to_string() }

/// The common fields of a request, before its own: `"protocol":1,"schemaVersion":27,"clientId":"…"`.
async fn head(protocol: i64) -> String {
    let id = first(sql("SELECT client_id FROM _sync_meta", vec![]).await).map(|r| s(&r[0])).unwrap_or_default();
    format!("\"protocol\":{protocol},\"schemaVersion\":{SCHEMA_VERSION},\"clientId\":{}", text(&id))
}

/// A push of the queue, oldest first, or of its first `limit` (what the shell's uploads let go now); None when there
/// is nothing to send. Each change's arguments go as the text the core queued, unchanged.
pub async fn push_body(protocol: i64, limit: Option<usize>) -> Option<String> {
    let rows = sql("SELECT id, name, v, args FROM _mutation ORDER BY id", vec![]).await;
    let changes: Vec<String> = rows
        .iter()
        .take(limit.unwrap_or(usize::MAX))
        .map(|m| format!("{{\"id\":{},\"name\":{},\"v\":{},\"args\":{}}}", int_of(&m[0]), text(&s(&m[1])), int_of(&m[2]), s(&m[3])))
        .collect();
    if changes.is_empty() { return None }
    Some(format!("{{{},\"mutations\":[{}]}}", head(protocol).await, changes.join(",")))
}

/// A pull from the device's cookie, or from `cookie` for the page after one that said `more`.
pub async fn pull_body(protocol: i64, cookie: Option<&Value>) -> String {
    let meta = first(sql("SELECT cookie, last_mutation_id FROM _sync_meta", vec![]).await).unwrap_or_else(|| vec![Value::Null, json!(0)]);
    let cookie = cookie.cloned().unwrap_or_else(|| meta[0].clone());
    format!("{{{},\"cookie\":{},\"lastMutationId\":{}}}", head(protocol).await, cookie, int_of(&meta[1]))
}

/// What an answer of the server's means.
#[derive(Debug, Clone, PartialEq)]
pub enum Answer {
    /// 200: its body.
    Ok(Value),
    /// Syncing stops until the app is updated ("update-required") or the person signs in again (the credentials'
    /// refusal); the queue is kept.
    Stop(String),
    /// Any other answer: this try failed, the next one repeats it.
    Failed(String),
}

/// An answer of the server's to `what` ("push" or "pull"): its status and body (null when it was not JSON).
pub fn read(what: &str, status: i64, body: &Value) -> Answer {
    let error = body.get("error").and_then(Value::as_str);
    match (status, error) {
        (426, Some("update-required")) => Answer::Stop("update-required".into()),
        (401 | 403, Some(e)) if SIGNED_OUT.contains(&e) => Answer::Stop(e.into()),
        (200, _) => Answer::Ok(body.clone()),
        _ => Answer::Failed(format!("{what} failed: {status} {body}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn update_required_stops_syncing() {
        let answer = read("push", 426, &json!({ "error": "update-required", "minimumProtocol": 1 }));

        assert_eq!(answer, Answer::Stop("update-required".into()));
    }

    #[test]
    fn a_refused_credential_stops_syncing_with_its_reason() {
        let answer = read("pull", 403, &json!({ "error": "device-not-paired" }));

        assert_eq!(answer, Answer::Stop("device-not-paired".into()));
    }

    #[test]
    fn another_refusal_is_a_failed_try() {
        let answer = read("pull", 403, &json!({ "error": "forbidden" }));

        assert_eq!(answer, Answer::Failed("pull failed: 403 {\"error\":\"forbidden\"}".into()));
    }

    #[test]
    fn a_426_without_its_error_is_a_failed_try() {
        let answer = read("push", 426, &Value::Null);

        assert_eq!(answer, Answer::Failed("push failed: 426 null".into()));
    }

    #[test]
    fn a_200_is_its_body() {
        let answer = read("pull", 200, &json!({ "cookie": "c", "more": false }));

        assert_eq!(answer, Answer::Ok(json!({ "cookie": "c", "more": false })));
    }
}
