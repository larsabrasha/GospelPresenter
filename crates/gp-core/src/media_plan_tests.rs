// Which blobs a queued change names (media_plan.rs `blobs_of`), one rule a test; the views' SQL against the web's
// own functions is crates/gp-core/parity/views/media-plan.mjs.
use super::*;

const A: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const B: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

#[test]
fn a_picture_names_its_full_picture_and_thumbnail() {
    assert_eq!(blobs_of("addImage", &json!({ "fullHash": A, "thumbHash": B })), vec![A, B]);
}

#[test]
fn a_video_names_its_file_still_and_thumbnail() {
    assert_eq!(blobs_of("addVideo", &json!({ "hash": "v", "stillHash": "s", "thumbHash": "t" })), vec!["v", "s", "t"]);
}

#[test]
fn a_pdf_names_each_pages_two_pictures_once() {
    let pages = json!({ "pages": [{ "full": A, "thumb": B }, { "full": A, "thumb": B }] });

    assert_eq!(blobs_of("addSlides", &pages), vec![A, B]);
}

#[test]
fn a_slideshow_names_its_backgrounds_and_pictures() {
    let page = json!({ "backgroundPicture": { "full": "bg", "thumb": "bt" }, "backgroundPage": null,
        "elements": [{ "kind": "text" }, { "kind": "image", "picture": { "full": "ef", "thumb": "et" } }] });

    assert_eq!(blobs_of("createCustomSlide", &json!({ "pages": [page] })), vec!["bg", "bt", "ef", "et"]);
}

#[test]
fn an_overlay_names_its_one_pages_pictures() {
    let page = json!({ "backgroundPicture": { "full": "of", "thumb": "ot" }, "elements": [] });

    assert_eq!(blobs_of("updateOverlay", &json!({ "page": page })), vec!["of", "ot"]);
}

#[test]
fn a_page_that_does_not_read_names_nothing() {
    assert_eq!(blobs_of("createCustomSlide", &json!({ "pages": [{ "backgroundPicture": { "full": "x", "thumb": "y" } }] })), Vec::<String>::new());
}

#[test]
fn a_theme_names_its_picture_backgrounds() {
    let picture = |f: &str| json!({ "image": { "kind": "picture", "full": f, "thumb": format!("{f}t") } });
    let definition = json!({ "song": { "background": picture("s") }, "bible": { "background": { "image": null } }, "media": picture("m") });

    assert_eq!(blobs_of("updateTheme", &json!({ "definition": definition })), vec!["s", "st", "m", "mt"]);
}

#[test]
fn a_missing_field_is_named_as_the_web_named_it() {
    assert_eq!(blobs_of("addAudio", &json!({})), vec!["undefined"]);
}

#[test]
fn a_number_is_named_as_javascript_writes_it() {
    let names: Vec<String> = [json!(5), json!(5.0), json!(2.5), json!(true), json!([1, null, "a"]), json!({})].iter().map(|v| js_string(Some(v))).collect();

    assert_eq!(names, ["5", "5", "2.5", "true", "1,,a", "[object Object]"]);
}

#[test]
fn only_a_sha256_in_lowercase_hex_is_a_hash() {
    assert_eq!([is_hash(A), is_hash("undefined"), is_hash(&A.to_uppercase())], [true, false, false]);
}
