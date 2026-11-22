// The autosaved field's rules, one a test (autosave.rs), as the web's AutoSaveField and its tests decide them.
use super::*;
use crate::view_types::AutoSaveEvent as Ev;

/// A song's field (`updateSong`, the song's id), its kind and stored value.
fn field(kind: &str, stored: &str, clash: bool) -> AutoSaveStep {
    let init = json!({ "init": { "command": "updateSong", "args": { "id": "s1" }, "field": "name", "kind": kind, "max": 10, "warnOnClash": clash, "stored": stored } });
    serde_json::from_value(view(init.as_object().unwrap()).unwrap()).unwrap()
}

fn after(from: AutoSaveStep, events: Vec<Ev>) -> AutoSaveStep {
    events.into_iter().fold(from, |s, e| {
        let a = json!({ "state": s.state, "event": e });
        serde_json::from_value(view(a.as_object().unwrap()).unwrap()).unwrap()
    })
}

fn input(v: &str) -> Ev { Ev::Input { value: v.into() } }
fn runs(s: &AutoSaveStep) -> Vec<Value> { s.effects.iter().filter_map(|e| if let Do::Run { args, .. } = e { Some(args.clone()) } else { None }).collect() }

#[test]
fn typing_waits_half_a_second() {
    let out = after(field("text", "Härlig", false), vec![Ev::Focus, input("Härlig är")]);

    assert_eq!(out.effects, vec![Do::Timer { ms: 500 }]);
}

#[test]
fn the_half_second_out_writes_the_value() {
    let out = after(field("text", "Härlig", false), vec![Ev::Focus, input("Härlig är"), Ev::Timer]);

    assert_eq!(runs(&out), vec![json!({ "id": "s1", "name": "Härlig är" })]);
}

#[test]
fn leaving_the_field_writes_at_once() {
    let out = after(field("text", "Härlig", false), vec![Ev::Focus, input("Härlig är"), Ev::Blur]);

    assert_eq!(runs(&out), vec![json!({ "id": "s1", "name": "Härlig är" })]);
}

#[test]
fn typed_back_to_what_is_stored_nothing_is_written() {
    let out = after(field("text", "Härlig", false), vec![Ev::Focus, input("Härli"), input("Härlig"), Ev::Blur]);

    assert_eq!(runs(&out), Vec::<Value>::new());
}

#[test]
fn typed_back_to_the_last_write_nothing_is_written_again() {
    let out = after(field("text", "Härlig", false), vec![Ev::Focus, input("Ny"), Ev::Timer, input("Nya"), input("Ny"), Ev::Blur]);

    assert_eq!(runs(&out), Vec::<Value>::new());
}

#[test]
fn a_value_refused_is_written_again() {
    let out = after(field("text", "Härlig", false), vec![Ev::Focus, input("Ny"), Ev::Timer, Ev::Done { ok: false }, input("Nya"), input("Ny"), Ev::Blur]);

    assert_eq!(runs(&out), vec![json!({ "id": "s1", "name": "Ny" })]);
}

#[test]
fn a_write_done_says_saved_and_one_refused_says_so() {
    let ok = after(field("text", "a", false), vec![Ev::Focus, input("b"), Ev::Blur, Ev::Done { ok: true }]);
    let no = after(field("text", "a", false), vec![Ev::Focus, input("b"), Ev::Blur, Ev::Done { ok: false }]);

    assert_eq!((ok.effects, no.effects), (vec![Do::Saved], vec![Do::Failed]));
}

#[test]
fn a_blank_name_is_not_written_and_shows_the_stored_one_once_left() {
    let out = after(field("required", "Härlig", false), vec![Ev::Focus, input("  "), Ev::Blur]);

    assert_eq!((runs(&out), out.shown.clone()), (Vec::<Value>::new(), "Härlig".to_string()));
}

#[test]
fn a_year_is_written_as_a_number() {
    let out = after(field("year", "", false), vec![Ev::Focus, input("1998"), Ev::Blur]);

    assert_eq!(runs(&out), vec![json!({ "id": "s1", "name": 1998 })]);
}

#[test]
fn an_empty_year_is_written_as_none() {
    let out = after(field("year", "1998", false), vec![Ev::Focus, input(""), Ev::Blur]);

    assert_eq!(runs(&out), vec![json!({ "id": "s1", "name": null })]);
}

#[test]
fn a_year_that_is_not_one_is_not_written() {
    let out = after(field("year", "1998", false), vec![Ev::Focus, input("19x8"), Ev::Blur]);

    assert_eq!((runs(&out), out.shown.clone()), (Vec::<Value>::new(), "1998".to_string()));
}

#[test]
fn typing_is_cut_to_the_fields_length() {
    let out = after(field("text", "", false), vec![Ev::Focus, input("abcdefghijklmno")]);

    assert_eq!(out.shown, "abcdefghij");
}

#[test]
fn the_stored_value_shows_when_the_user_is_not_typing() {
    let out = after(field("text", "Härlig", false), vec![Ev::Stored { value: "Ändrad".into() }]);

    assert_eq!(out.shown, "Ändrad");
}

#[test]
fn the_users_text_stays_while_they_type_though_the_stored_one_changes() {
    let out = after(field("text", "Härlig", false), vec![Ev::Focus, input("Min"), Ev::Stored { value: "Annan".into() }]);

    assert_eq!(out.shown, "Min");
}

#[test]
fn another_devices_change_while_typing_is_a_clash_and_stops_the_writing() {
    let out = after(field("text", "Härlig", true), vec![Ev::Focus, input("Min"), Ev::Stored { value: "Annan".into() }, Ev::Blur]);

    assert_eq!((out.clash.clone(), runs(&out)), (Some("Annan".to_string()), Vec::<Value>::new()));
}

#[test]
fn the_fields_own_write_coming_back_is_no_clash() {
    let out = after(field("text", "Härlig", true), vec![Ev::Focus, input("Min"), Ev::Timer, Ev::Done { ok: true }, input("Mina"), Ev::Stored { value: "Min".into() }]);

    assert_eq!(out.clash, None);
}

#[test]
fn keep_mine_writes_the_users_text_at_once() {
    let out = after(field("text", "Härlig", true), vec![Ev::Focus, input("Min"), Ev::Stored { value: "Annan".into() }, Ev::KeepMine]);

    assert_eq!((out.clash.clone(), runs(&out)), (None, vec![json!({ "id": "s1", "name": "Min" })]));
}

#[test]
fn take_theirs_shows_the_other_text_and_writes_nothing() {
    let out = after(field("text", "Härlig", true), vec![Ev::Focus, input("Min"), Ev::Stored { value: "Annan".into() }, Ev::TakeTheirs, Ev::Blur]);

    assert_eq!((out.shown.clone(), runs(&out)), ("Annan".to_string(), Vec::<Value>::new()));
}

#[test]
fn without_warning_another_devices_change_is_no_clash() {
    let out = after(field("text", "Härlig", false), vec![Ev::Focus, input("Min"), Ev::Stored { value: "Annan".into() }]);

    assert_eq!(out.clash, None);
}
