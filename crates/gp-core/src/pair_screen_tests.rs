// "Anslut tillfällig skärm"'s rules, one a test (pair_screen.rs), as the web's PairScreenDialog decides them.
use super::*;
use crate::view_types::PairEvent as Ev;

fn opened() -> PairStep {
    serde_json::from_value(view(json!({ "init": { "sessionId": "s1", "base": "https://host:47843/" } }).as_object().unwrap()).unwrap()).unwrap()
}

fn after(events: Vec<Ev>) -> PairStep {
    events.into_iter().fold(opened(), |s, e| {
        serde_json::from_value(view(json!({ "state": s.state, "event": e }).as_object().unwrap()).unwrap()).unwrap()
    })
}

fn made(token: &str) -> Ev { Ev::Answer { request: "make".into(), token: None, body: json!({ "token": token }) } }
fn screen(request: &str, token: Option<&str>) -> Ev { Ev::Answer { request: request.into(), token: token.map(String::from), body: json!({ "screen": { "id": "tv1", "n": 3 } }) } }
fn asked(s: &PairStep) -> Vec<(String, String)> {
    s.effects.iter().filter_map(|e| if let Do::Request { request, path, .. } = e { Some((request.clone(), path.clone())) } else { None }).collect()
}

#[test]
fn opening_asks_for_a_token_and_sets_the_renewal_and_the_asking() {
    let out = after(vec![Ev::Open]);

    assert_eq!(out.effects, vec![
        Do::Request { request: "make".into(), token: None, method: "POST".into(), path: "/api/live/screens/token".into(), body: None },
        Do::Timer { name: "renew".into(), ms: 480_000 },
        Do::Timer { name: "poll".into(), ms: 2000 },
    ]);
}

#[test]
fn the_qr_code_shows_the_display_pages_link_with_the_token() {
    let out = after(vec![Ev::Open, made("t1")]);

    assert_eq!((out.link.as_deref(), out.address.as_str()), (Some("https://host:47843/display?token=t1"), "https://host:47843/display"));
}

#[test]
fn the_asking_asks_whether_a_tv_used_the_token() {
    let out = after(vec![Ev::Open, made("t1"), Ev::Timer { name: "poll".into() }]);

    assert_eq!(asked(&out), vec![("poll".to_string(), "/api/live/screens/token/t1?session=s1".to_string())]);
}

#[test]
fn a_renewed_token_lets_the_old_one_go() {
    let out = after(vec![Ev::Open, made("t1"), Ev::Timer { name: "renew".into() }, made("t2")]);

    assert_eq!((asked(&out), out.state.token.as_deref()), (vec![("drop".to_string(), "/api/live/screens/token/t1?session=s1".to_string())], Some("t2")));
}

#[test]
fn a_tv_that_used_the_token_is_switched_on_and_said_so() {
    let out = after(vec![Ev::Open, made("t1"), screen("poll", Some("t1"))]);

    assert_eq!(out.effects, vec![Do::Output { id: "tv1".into() }, Do::CancelTimers]);
    assert_eq!(out.state.paired.map(|s| s.n), Some(3));
}

#[test]
fn closing_lets_the_token_go() {
    let out = after(vec![Ev::Open, made("t1"), Ev::Close]);

    assert_eq!(out.effects.first(), Some(&Do::CancelTimers));
    assert_eq!(asked(&out), vec![("drop".to_string(), "/api/live/screens/token/t1?session=s1".to_string())]);
}

#[test]
fn a_tv_that_used_the_token_before_the_close_is_switched_on_all_the_same() {
    let out = after(vec![Ev::Open, made("t1"), Ev::Close, screen("drop", Some("t1"))]);

    assert_eq!((out.effects, out.state.paired), (vec![Do::Output { id: "tv1".into() }], None));
}

#[test]
fn a_token_made_after_the_close_is_let_go_at_once() {
    let out = after(vec![Ev::Open, Ev::Close, made("late")]);

    assert_eq!(asked(&out), vec![("drop".to_string(), "/api/live/screens/token/late?session=s1".to_string())]);
}

#[test]
fn the_digits_typed_are_claimed_for_the_session() {
    let out = after(vec![Ev::Open, Ev::Submit { pin: "1234".into() }]);

    assert_eq!(out.effects, vec![Do::Request {
        request: "claim".into(), token: None, method: "POST".into(), path: "/api/live/screens/claim".into(), body: Some(json!({ "pin": "1234", "sessionId": "s1" })),
    }]);
}

#[test]
fn a_wrong_code_is_counted_and_another_may_be_typed() {
    let out = after(vec![Ev::Open, Ev::Submit { pin: "1234".into() }, Ev::Answer { request: "claim".into(), token: None, body: json!({ "error": "pin-invalid" }) }]);

    assert_eq!((out.state.wrong, out.state.busy), (1, false));
}

#[test]
fn a_code_is_not_sent_twice_while_one_is_checked() {
    let out = after(vec![Ev::Open, Ev::Submit { pin: "1234".into() }, Ev::Submit { pin: "5678".into() }]);

    assert_eq!(out.effects, vec![]);
}

#[test]
fn the_timers_stop_once_paired() {
    let out = after(vec![Ev::Open, made("t1"), screen("poll", Some("t1")), Ev::Timer { name: "poll".into() }]);

    assert_eq!(out.effects, vec![]);
}
