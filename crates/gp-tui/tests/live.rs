// The live state from outside the page's keys: a controller's command taken, a session elsewhere shown, and this
// device driving one (remote control), its changes left for the shell to send.
mod common;

use gp_tui::views::LivePointer;
use serde_json::json;

#[test]
fn a_command_taken_while_the_page_is_open_moves_the_live_state() {
    let mut app = common::presenting("apply-open");
    let item = app.live.item_id.clone();

    app.apply(json!({ "itemId": item, "partIndex": 1, "black": false }));

    assert_eq!(common::shown(&app).1, 1);
}

#[test]
fn a_command_taken_from_the_start_page_moves_the_live_state() {
    let mut app = common::presenting("apply-start");
    let item = app.live.item_id.clone();
    app.act(gp_tui::keys::Action::Back);

    app.apply(json!({ "itemId": item, "partIndex": 1, "black": false }));

    assert_eq!(common::shown(&app).1, 1);
}

#[test]
fn a_session_elsewhere_is_shown_as_its_owner_reports_it() {
    let mut app = common::demo("adopt");
    app.open("pres-main");
    let item = app.page.as_ref().unwrap().items[1].id.clone();
    let live = LivePointer { presentation_id: Some("pres-main".into()), item_id: Some(item.clone()), part_index: 0, black: false, overlay_id: None, rev: 7 };

    app.adopt(live);

    assert_eq!(common::shown(&app), (Some(item.as_str()), 0));
}

#[test]
fn driving_a_session_elsewhere_leaves_the_live_state_and_sends_the_change() {
    let mut app = common::presenting("remote");
    let before = app.live.clone();
    app.remote = true;

    common::press(&mut app, ratatui::crossterm::event::KeyCode::Right);
    common::press(&mut app, ratatui::crossterm::event::KeyCode::Enter);

    assert_eq!(app.live, before);
    assert!(app.outbox.as_ref().is_some_and(|c| c["partIndex"] == json!(1)), "{:?}", app.outbox);
}
