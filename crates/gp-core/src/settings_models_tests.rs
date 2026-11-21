use super::*;

fn args(v: Value) -> Obj { v.as_object().unwrap().clone() }

fn ids(groups: &Value) -> Vec<String> {
    groups.as_array().unwrap().iter().flat_map(|g| g["rows"].as_array().unwrap().iter().map(|r| r["id"].as_str().unwrap().to_string())).collect()
}

fn texts() -> Value {
    json!({ "nav.songs": "Sånger", "search.songs": "låtar,psalmer", "nav.displays": "Skärmar", "search.displays": "projektor,qr,länk",
            "settings.language": "Språk", "search.language": "svenska,engelska", "nav.orgs": "Organisationer" })
}

#[test]
fn an_admin_sees_the_four_groups_then_the_trash_and_about_apart() {
    let groups = list(&args(json!({ "role": "admin", "host": false }))).unwrap();

    let titles: Vec<Value> = groups.as_array().unwrap().iter().map(|g| g["title"].clone()).collect();

    assert_eq!(titles, vec![json!("settings.group.library"), json!("settings.group.presentation"), json!("settings.group.display"),
        json!("settings.group.church"), Value::Null, Value::Null]);
}

#[test]
fn only_a_superadmin_sees_the_organisations_and_the_bug_reports() {
    let admin = ids(&list(&args(json!({ "role": "admin" }))).unwrap());
    let sup = ids(&list(&args(json!({ "role": "superAdmin" }))).unwrap());

    assert!(!admin.contains(&"orgs".into()) && !admin.contains(&"reports".into()));
    assert!(sup.contains(&"orgs".into()) && sup.contains(&"reports".into()));
}

#[test]
fn devices_show_only_on_a_host() {
    let cloud = ids(&list(&args(json!({ "role": "admin", "host": false }))).unwrap());
    let host = ids(&list(&args(json!({ "role": "admin", "host": true }))).unwrap());

    assert!(!cloud.contains(&"devices".into()));
    assert!(host.contains(&"devices".into()));
}

#[test]
fn a_user_sees_no_page_they_may_not_open_and_no_empty_group() {
    let groups = list(&args(json!({ "role": "user", "host": true }))).unwrap();

    assert_eq!(ids(&groups), vec!["songs", "images", "audios", "videos", "customSlides", "overlays", "labels", "themes", "trash", "about"]);
}

#[test]
fn templates_are_in_no_group() {
    let all = ids(&list(&args(json!({ "role": "superAdmin", "host": true }))).unwrap());

    assert!(!all.contains(&"templates".into()));
}

#[test]
fn a_row_carries_its_icon_colour_and_intro() {
    let groups = list(&args(json!({ "role": "admin" }))).unwrap();

    let displays = groups[2]["rows"][0].clone();

    assert_eq!(displays, json!({ "id": "displays", "text": "nav.displays", "icon": "display", "colour": { "name": "sky-500", "hex": "#0ea5e9" },
        "keywords": "search.displays", "intro": "intro.displays", "where": null }));
}

#[test]
fn a_role_is_required() {
    assert!(list(&args(json!({}))).is_err());
}

#[test]
fn search_finds_a_row_by_its_name_whatever_the_case() {
    let found = search(&args(json!({ "role": "admin", "query": "sÅNG", "texts": texts() }))).unwrap();

    assert_eq!(ids(&json!([{ "rows": found }])), vec!["songs"]);
}

#[test]
fn search_finds_a_row_by_a_word_of_its_own_and_needs_every_word() {
    let found = search(&args(json!({ "role": "admin", "query": "qr  länk", "texts": texts() }))).unwrap();

    assert_eq!(ids(&json!([{ "rows": found }])), vec!["displays"]);
}

#[test]
fn search_finds_what_my_settings_hold_and_says_where_it_lives() {
    let found = search(&args(json!({ "role": "admin", "query": "språk", "texts": texts() }))).unwrap();

    assert_eq!((found[0]["id"].clone(), found[0]["where"].clone()), (json!("settings"), json!("nav.settings")));
}

#[test]
fn search_finds_no_row_the_user_may_not_open() {
    let found = search(&args(json!({ "role": "admin", "query": "organisationer", "texts": texts() }))).unwrap();

    assert_eq!(found, json!([]));
}

#[test]
fn search_finds_nothing_for_an_empty_query() {
    assert_eq!(search(&args(json!({ "role": "admin", "query": "  ", "texts": texts() }))).unwrap(), json!([]));
}

fn mine_ids(a: Value) -> Vec<String> { ids(&mine(&args(a)).unwrap()["groups"]) }

#[test]
fn my_settings_hold_the_profile_theme_language_device_and_account() {
    let groups = mine(&args(json!({ "role": "admin" }))).unwrap();

    let order: Vec<&str> = groups["groups"].as_array().unwrap().iter().map(|g| g["id"].as_str().unwrap()).collect();

    assert_eq!(order, vec!["profile", "theme", "language", "thisDevice", "account"]);
}

#[test]
fn confirm_email_is_offered_only_for_an_unconfirmed_address_where_the_server_mails() {
    let unconfirmed = mine_ids(json!({ "role": "admin", "email": "a@b.se", "emailConfirmed": false, "mail": true }));
    let no_mail = mine_ids(json!({ "role": "admin", "email": "a@b.se", "emailConfirmed": false, "mail": false }));
    let confirmed = mine_ids(json!({ "role": "admin", "email": "a@b.se", "emailConfirmed": true, "mail": true }));

    assert!(unconfirmed.contains(&"confirmEmail".into()));
    assert!(!no_mail.contains(&"confirmEmail".into()) && !confirmed.contains(&"confirmEmail".into()));
}

#[test]
fn super_mode_is_offered_to_a_superadmin_and_on_while_their_role_is_superadmin() {
    let groups = mine(&args(json!({ "role": "superAdmin", "superAdmin": true }))).unwrap();

    assert_eq!(groups["groups"][1]["rows"][0]["on"], json!(true));
    assert!(!mine_ids(json!({ "role": "admin" })).contains(&"superMode".into()));
}

#[test]
fn auto_outputs_are_offered_only_in_the_desktop_app() {
    assert!(mine_ids(json!({ "role": "admin", "desktop": true })).contains(&"autoOutputs".into()));
    assert!(!mine_ids(json!({ "role": "admin", "desktop": false })).contains(&"autoOutputs".into()));
}
