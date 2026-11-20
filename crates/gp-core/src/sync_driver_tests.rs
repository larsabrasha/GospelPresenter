// The sync driver's rules, one a test (sync_driver.rs).
use super::*;

fn idle() -> State { fresh(PROTOCOL_VERSION, false) }
fn ask() -> Event { Event::Sync { parts: BOTH, media: false } }
fn ok(body: Value) -> Event { Event::Answer { status: 200, body } }
fn page(more: bool) -> Event { ok(json!({ "cookie": "c2", "lastMutationId": 0, "more": more, "patch": [], "results": [] })) }
fn ended(run: i64) -> Do { Do::Ended { run, error: None } }

/// The state after each event in turn, and what the last one did.
fn after(st: State, events: &[Event]) -> (State, Vec<Do>) {
    events.iter().fold((st, vec![]), |(s, _), e| step(&s, e))
}

/// A device started with its socket open.
fn online() -> State { after(idle(), &[Event::Start, Event::SocketOpened, Event::NothingToPush, page(false), Event::Rebased]).0 }

#[test]
fn a_sync_pushes_first() {
    let (s, out) = step(&idle(), &ask());

    assert_eq!((s.busy, s.phase, out), (true, Phase::Push, vec![Do::Queued(1), Do::Push(None)]));
}

#[test]
fn a_push_answered_is_followed_by_a_pull() {
    let (s, out) = after(idle(), &[ask(), ok(json!({ "lastMutationId": 1, "results": [] }))]);

    assert_eq!((s.phase, out), (Phase::Pull, vec![Do::Pull(None)]));
}

#[test]
fn nothing_to_push_goes_straight_to_the_pull() {
    let (_, out) = after(idle(), &[ask(), Event::NothingToPush]);

    assert_eq!(out, vec![Do::Pull(None)]);
}

#[test]
fn a_page_with_more_is_kept_and_the_next_pulled_from_its_cookie() {
    let (_, out) = after(idle(), &[ask(), Event::NothingToPush, page(true)]);

    assert_eq!(out, vec![Do::KeepPage, Do::Pull(Some(json!("c2")))]);
}

#[test]
fn the_last_page_is_kept_and_the_queue_rebased() {
    let (s, out) = after(idle(), &[ask(), Event::NothingToPush, page(false)]);

    assert_eq!((s.phase, out), (Phase::Rebase, vec![Do::KeepPage, Do::Rebase]));
}

#[test]
fn a_run_rebased_ends_and_the_device_is_idle() {
    let (s, out) = after(idle(), &[ask(), Event::NothingToPush, page(false), Event::Rebased]);

    assert_eq!((s.busy, out), (false, vec![ended(1), Do::Idle]));
}

#[test]
fn syncs_asked_while_one_runs_are_one_run_after_it() {
    let (s, out) = after(idle(), &[ask(), ask(), ask()]);

    assert_eq!((s.run, s.again, out), (1, Some(BOTH), vec![Do::Queued(2)]));
}

#[test]
fn the_run_asked_meanwhile_begins_when_the_first_ends() {
    let (s, out) = after(idle(), &[ask(), ask(), Event::NothingToPush, page(false), Event::Rebased]);

    assert_eq!((s.busy, s.run, out), (true, 2, vec![ended(1), Do::Push(None)]));
}

#[test]
fn a_failed_request_ends_the_run_with_its_error() {
    let (s, out) = after(idle(), &[ask(), Event::Failed("offline".into())]);

    assert_eq!((s.busy, out), (false, vec![Do::Ended { run: 1, error: Some("offline".into()) }, Do::Idle]));
}

#[test]
fn a_server_error_ends_the_run_as_a_failure() {
    let (_, out) = after(idle(), &[ask(), Event::Answer { status: 500, body: json!({ "error": "internal" }) }]);

    assert_eq!(out[0], Do::Ended { run: 1, error: Some("push failed: 500 {\"error\":\"internal\"}".into()) });
}

#[test]
fn update_required_stops_syncing_and_closes_the_socket() {
    let st = after(online(), &[ask()]).0;

    let (s, out) = step(&st, &Event::Answer { status: 426, body: json!({ "error": "update-required" }) });

    assert_eq!((s.stopped.as_deref(), s.socket, out), (Some("update-required"), Socket::Closed, vec![Do::CloseSocket, ended(2), Do::Idle]));
}

#[test]
fn a_sync_while_stopped_ends_at_once() {
    let st = after(idle(), &[ask(), Event::Answer { status: 401, body: json!({ "error": "unauthenticated" }) }]).0;

    let (s, out) = step(&st, &ask());

    assert_eq!((s.busy, out), (false, vec![Do::Queued(2), ended(2), Do::Idle]));
}

#[test]
fn a_shell_that_uploads_first_is_asked_before_the_push() {
    let (_, out) = step(&fresh(PROTOCOL_VERSION, true), &ask());

    assert_eq!(out, vec![Do::Queued(1), Do::BeforePush]);
}

#[test]
fn the_push_takes_as_many_as_the_uploads_let_go() {
    let (_, out) = after(fresh(PROTOCOL_VERSION, true), &[ask(), Event::PushLimit(2)]);

    assert_eq!(out, vec![Do::Push(Some(2))]);
}

#[test]
fn a_push_alone_does_not_pull() {
    let (s, out) = after(idle(), &[Event::Sync { parts: Parts { push: true, pull: false }, media: false }, Event::NothingToPush]);

    assert_eq!((s.busy, out), (false, vec![ended(1), Do::Idle]));
}

#[test]
fn starting_opens_the_socket_and_sets_the_poll() {
    let (s, out) = step(&idle(), &Event::Start);

    assert_eq!((s.socket, out), (Socket::Opening, vec![Do::Timer("poll", POLL_MS), Do::OpenSocket]));
}

#[test]
fn the_socket_opened_syncs_and_fetches_the_media_after() {
    let (_, out) = after(idle(), &[Event::Start, Event::SocketOpened, Event::NothingToPush, page(false), Event::Rebased]);

    assert_eq!(out, vec![ended(1), Do::Idle, Do::Media]);
}

#[test]
fn a_run_that_ends_after_closing_fetches_no_media() {
    let (_, out) = after(idle(), &[Event::Start, Event::SocketOpened, Event::Close, Event::NothingToPush, page(false), Event::Rebased]);

    assert_eq!(out, vec![ended(1), Do::Idle]);
}

#[test]
fn a_poke_syncs() {
    let (_, out) = step(&online(), &Event::Poke);

    assert_eq!(out, vec![Do::Queued(2), Do::Push(None)]);
}

#[test]
fn an_open_socket_closed_is_tried_again_after_3_s() {
    let (s, out) = step(&online(), &Event::SocketClosed);

    assert_eq!((s.socket, out), (Socket::Closed, vec![Do::Timer("reconnect", RECONNECT_MS)]));
}

#[test]
fn a_socket_refused_syncs_then_is_tried_again() {
    let (_, out) = after(idle(), &[Event::Start, Event::SocketClosed, Event::NothingToPush, page(false), Event::Rebased]);

    assert_eq!(out, vec![ended(1), Do::Idle, Do::Timer("reconnect", RECONNECT_MS)]);
}

#[test]
fn a_socket_refused_with_the_credentials_is_not_tried_again() {
    let refused = Event::Answer { status: 403, body: json!({ "error": "not-a-member" }) };

    let (s, out) = after(idle(), &[Event::Start, Event::SocketClosed, refused]);

    assert_eq!((s.stopped.as_deref(), out), (Some("not-a-member"), vec![ended(1), Do::Idle]));
}

#[test]
fn the_reconnect_timer_opens_the_socket() {
    let st = step(&online(), &Event::SocketClosed).0;

    let (s, out) = step(&st, &Event::Timer("reconnect".into()));

    assert_eq!((s.socket, out), (Socket::Opening, vec![Do::OpenSocket]));
}

#[test]
fn the_poll_syncs_and_is_set_again() {
    let (_, out) = step(&online(), &Event::Timer("poll".into()));

    assert_eq!(out, vec![Do::Timer("poll", POLL_MS), Do::Queued(2), Do::Push(None)]);
}

#[test]
fn closing_closes_the_socket_and_cancels_the_timers() {
    let (s, out) = step(&online(), &Event::Close);

    assert_eq!((s.started, s.socket, out), (false, Socket::Closed, vec![Do::CloseSocket, Do::CancelTimers]));
}

#[test]
fn a_timer_after_closing_does_nothing() {
    let st = step(&online(), &Event::Close).0;

    let (_, out) = step(&st, &Event::Timer("poll".into()));

    assert_eq!(out, vec![]);
}

#[test]
fn an_answer_with_no_request_out_is_ignored() {
    let (s, out) = step(&idle(), &page(false));

    assert_eq!((s, out), (idle(), vec![]));
}

#[test]
fn the_state_reads_back_as_it_was_written() {
    let st = after(fresh(0, true), &[Event::Start, Event::SocketOpened, ask()]).0;

    let back = state_of(&state_json(&st)).unwrap();

    assert_eq!(back, st);
}
