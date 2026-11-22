// A device signed in to a host: its changes go through sync's queue (`syncMutate`), as the web's SyncClient's do.
mod common;

use serde_json::{json, Value};

fn pending(app: &gp_tui::app::App) -> usize {
    app.core().call("syncPending", json!({})).ok().and_then(|v| v.as_array().map(Vec::len)).unwrap_or(0)
}

fn signed_in(name: &str) -> gp_tui::app::App {
    let app = common::demo(name);
    app.core().command("syncOpen", json!({ "clientId": "test-client" })).unwrap();
    app.core().queue_changes().unwrap();
    app
}

#[test]
fn a_change_signed_in_is_queued_for_the_server() {
    let mut app = signed_in("queued");

    let done = app.run("renamePresentation", json!({ "id": "pres-main", "name": "Gudstjänst" }));

    assert!(done);
    assert_eq!(pending(&app), 1);
}

#[test]
fn a_change_signed_in_is_shown_at_once() {
    let mut app = signed_in("shown");

    app.run("renamePresentation", json!({ "id": "pres-main", "name": "Gudstjänst" }));

    let page: Value = app.core().call("presentationPageView", json!({ "id": "pres-main" })).unwrap();
    assert_eq!(page["presentation"]["name"], json!("Gudstjänst"));
}

#[test]
fn a_change_without_signing_in_is_not_queued() {
    let mut app = common::demo("local");
    app.core().command("syncOpen", json!({ "clientId": "test-client" })).unwrap();

    app.run("renamePresentation", json!({ "id": "pres-main", "name": "Gudstjänst" }));

    assert_eq!(pending(&app), 0);
}

#[test]
fn a_change_queued_is_told_to_the_shell() {
    let mut app = signed_in("told");
    let told = std::rc::Rc::new(std::cell::Cell::new(0));
    let count = told.clone();
    app.core().on_change(Box::new(move || count.set(count.get() + 1)));

    app.run("renamePresentation", json!({ "id": "pres-main", "name": "Gudstjänst" }));

    assert_eq!(told.get(), 1);
}
