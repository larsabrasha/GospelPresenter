use super::*;

fn page(kind: &str, role: &str) -> Value {
    library_page(json!({ "kind": kind, "role": role }).as_object().unwrap()).unwrap()
}

fn ids(actions: &Value) -> Vec<&str> { actions.as_array().unwrap().iter().map(|a| a["id"].as_str().unwrap()).collect() }

#[test]
fn songs_add_a_song_and_import_beside_it() {
    let p = page("songs", "user");

    assert_eq!((p["add"]["id"].as_str(), p["add"]["text"].as_str()), (Some("new"), Some("songs.new")));
    assert_eq!(p["extra"]["text"], "songs.import.short");
}

#[test]
fn a_collection_picks_and_a_list_of_pages_does_not() {
    let songs = page("songs", "admin");
    let users = page("users", "admin");

    assert_eq!((songs["list"].as_str(), songs["pick"].as_bool()), (Some("collection"), Some(true)));
    assert_eq!((users["list"].as_str(), users["pick"].as_bool()), (Some("pages"), Some(false)));
    assert!(users["picked"].as_array().unwrap().is_empty());
}

#[test]
fn a_file_library_offers_nothing_to_one_who_may_not_manage_it() {
    let p = page("images", "guest");

    assert!(p["add"].is_null());
    assert_eq!(p["pick"], false);
    assert!(p["row"].as_array().unwrap().is_empty());
}

#[test]
fn a_picture_offers_revert_only_where_it_was_edited() {
    let p = page("images", "user");

    let revert = p["row"].as_array().unwrap().iter().find(|a| a["id"] == "revert").unwrap();

    assert_eq!(revert["when"], "originalFullHash");
    assert_eq!(ids(&p["row"]), vec!["edit", "revert", "rename", "download", "delete"]);
}

#[test]
fn a_slideshow_offers_replace_only_for_a_decks_pages() {
    let p = page("customSlides", "user");

    assert_eq!(p["row"][0]["id"], "replace");
    assert_eq!(p["row"][0]["when"], "fromDeck");
}

#[test]
fn only_own_themes_are_picked_and_only_by_one_who_manages_themes() {
    let admin = page("themes", "admin");
    let user = page("themes", "user");

    assert_eq!((admin["pick"].as_bool(), admin["pickOnly"].as_str()), (Some(true), Some("own")));
    assert_eq!(user["pick"], false);
    assert!(user["add"].is_null());
}

#[test]
fn the_trash_restores_and_purges_what_is_picked() {
    let p = page("trash", "user");

    assert_eq!(ids(&p["picked"]), vec!["restore", "purge"]);
    assert!(p["add"].is_null());
    assert_eq!(p["opens"], "none");
}

#[test]
fn users_are_made_on_a_host_and_invited_elsewhere() {
    let host = library_page(json!({ "kind": "users", "role": "admin", "host": true }).as_object().unwrap()).unwrap();
    let other = page("users", "admin");

    assert_eq!(host["add"]["text"], "users.create");
    assert_eq!(other["add"]["text"], "users.invite");
}

#[test]
fn a_user_may_not_add_users() {
    let p = page("users", "user");

    assert!(p["add"].is_null());
}

#[test]
fn every_removing_action_is_destructive() {
    for kind in ["songs", "bibles", "images", "audios", "videos", "customSlides", "overlays", "labels", "trash"] {
        let p = page(kind, "admin");

        for a in p["picked"].as_array().unwrap().iter().chain(p["row"].as_array().unwrap()) {
            let removes = ["delete", "purge"].contains(&a["id"].as_str().unwrap());
            assert_eq!(a["destructive"].as_bool(), Some(removes), "{kind}: {}", a["id"]);
        }
    }
}

#[test]
fn an_unknown_kind_is_refused() {
    let refused = library_page(json!({ "kind": "nothing", "role": "admin" }).as_object().unwrap());

    assert!(refused.is_err());
}
