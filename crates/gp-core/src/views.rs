// What the shells show, worked out in the core: the presentations, a presentation's items and slides
// (packages/core/src/slides.ts), and the song search for "Lägg till sång".
use crate::args::*;
use crate::bridge::sql;
use crate::search;
use serde_json::{json, Value};

fn s(v: &Value) -> String { v.as_str().unwrap_or("").to_string() }

/// `Some` for a view's name: what it answers.
pub async fn run(name: &str, a: &Obj) -> Option<R<Value>> {
    Some(match name {
        "presentationsView" => Ok(presentations().await),
        "presentationView" => match id(a, "id") { Ok(pid) => presentation(&pid).await, Err(e) => Err(e) },
        "trashView" => Ok(trash().await),
        "liveView" => crate::live::run(a).await,
        "searchSongsView" => Ok(songs(a.get("query").and_then(|q| q.as_str()).unwrap_or(""), crate::collation::lang(a)).await),
        "itemSlidesView" => crate::item_views::item_slides(a).await,
        "presentationPageView" => crate::presentation_page::view(a).await,
        "liveSlideView" => crate::live_views::slide(a).await,
        "overlayView" => crate::live_views::overlay_view(a).await,
        "songsView" => crate::song_views::songs(a).await,
        "songListView" => crate::song_views::song_list(a).await,
        "themeView" => crate::themes::view(a).await,
        "imagesView" => crate::media_views::images().await,
        "biblesView" => crate::settings_views::bibles(a).await,
        "bibleView" => crate::bible_view::view(a).await,
        "ownThemesView" => crate::settings_views::own_themes().await,
        "ownThemeView" => crate::settings_views::own_theme(a).await,
        "defaultThemeIdView" => crate::settings_views::default_theme_id().await,
        "ccliReportView" => crate::settings_views::ccli_report(a).await,
        "presentationListView" => crate::lists::presentations().await,
        "templatesView" => crate::lists::templates(a).await,
        "itemCountsView" => crate::lists::item_counts().await,
        "itemsView" => crate::lists::items(a).await,
        "labelsView" => crate::lists::labels().await,
        "songPartsView" => crate::lists::song_parts(a).await,
        "pinnedView" => crate::lists::pinned().await,
        "trashEntriesView" => crate::lists::trash().await,
        "audiosView" => crate::media_views::audios().await,
        "videosView" => crate::media_views::videos().await,
        "customSlidesView" => crate::media_views::custom_slides().await,
        "customSlideView" => crate::media_views::custom_slide_view(a).await,
        "overlaysView" => crate::media_views::overlays().await,
        "overlayRowView" => crate::media_views::overlay_row(a).await,
        "songView" => crate::song_page::one(a).await,
        "songPageView" => crate::song_page::page(a).await,
        "songPresentationsView" => crate::song_page::presentations(a).await,
        "songHistoryView" => crate::song_page::history(a).await,
        "songHistoryPageView" => crate::song_page::history_page(a).await,
        "songMaterialsView" => crate::song_page::materials(a).await,
        "presentationMaterialsView" => crate::song_page::presentation_materials(a).await,
        "songSearchPrepare" => crate::song_views::prepare(a).await,
        "songSearchView" => crate::song_views::search_view(a),
        "itemOverlaysView" => crate::live_views::item_overlays(a).await,
        "liveTargetsView" => crate::live_views::targets(a).await,
        "livePlaybackView" => crate::live_views::playback(a).await,
        "itemAudioView" => crate::live_views::item_audio(a).await,
        "wantedMediaView" => crate::media_wanted::view(a).await,
        "mediaPlanView" => crate::media_plan::plan_view(a).await,
        "mediaUploadsView" => crate::media_plan::uploads_view(a).await,
        "mediaStorageView" => crate::media_plan::storage_view(a).await,
        "bibleTextPlanView" => crate::bible_texts::plan_view(a).await,
        "bibleTextStoreView" => crate::bible_texts::store_view(a),
        "bibleTextJsonView" => crate::bible_texts::json_view(a).await,
        "bibleUploadsView" => crate::bible_texts::uploads_view(a).await,
        "bibleImportTextView" => crate::bible_texts::import_text_view(a),
        "syncStepView" => crate::sync_driver::view(a).await,
        "liveStepView" => crate::live_driver::view(a).await,
        "syncStatusView" => crate::sync_status::view(a),
        "playbackStepView" => crate::playback::view(a),
        "ccliUseView" => crate::live_views::ccli_use(a).await,
        "displaysView" => crate::live_views::displays(a).await,
        "remoteControlView" => crate::live_views::remote_control().await,
        "presentingKeyView" => crate::presenting::key(a),
        "liveChangeView" => crate::live_state::change(a),
        "followItemOverlayView" => crate::live_state::follow_item_overlay(a),
        "pageEventView" => crate::page_state::event(a),
        "pageModelView" => crate::page_state::model(a),
        "pageStepView" => crate::page_step::step(a),
        "slideAcrossView" => crate::grid_nav::view(a),
        "slideGridView" => crate::grid_nav::grid(a),
        "tickView" => crate::ticking::view(a),
        "bibleBrowseView" => crate::bible_browse::view(a),
        "addPickView" => crate::add_pick::view(a),
        "templateView" => crate::template_view::view(a),
        "paletteView" => crate::palette::view(a).await,
        "pageLayoutView" => crate::page_layout::view(a),
        "shownOnOutputsView" => crate::live_report::view(a),
        "outputRowsView" => crate::live_report::output_rows(a),
        "remoteCommandView" => crate::remote_control::command(a),
        "remotePointerView" => crate::remote_control::pointer(a),
        "remoteTakeView" => crate::remote_control::take(a),
        "addPositionView" => crate::page_models::add_position(a),
        "startPageView" => crate::page_models::start_page(a).await,
        "dateLineView" => crate::date_line::view(a),
        "presentationActionsView" => crate::page_models::presentation_actions(a),
        "itemActionsView" => crate::page_models::item_actions(a),
        "detailsDialogView" => crate::page_models::details_dialog(a),
        "detailsStepView" => crate::details_form::view(a).await,
        "autoSaveStepView" => crate::autosave::view(a),
        "pageButtonsView" => crate::page_models::page_buttons(a),
        "presentationColumnsView" => crate::page_models::presentation_columns(a),
        "lookView" => Ok(crate::look::view()),
        "settingsListView" => crate::settings_models::list(a),
        "settingsSearchView" => crate::settings_models::search(a),
        "settingsSearchKeysView" => Ok(crate::settings_models::search_keys()),
        "mySettingsView" => crate::settings_models::mine(a),
        "userRulesView" => crate::settings_models::user_rules(a),
        "autoOutputsView" => crate::settings_models::auto_outputs(a),
        "trashPageView" => crate::settings_pages::trash_page(a).await,
        "ccliPageView" => crate::settings_pages::ccli_page(a).await,
        "freshNameView" => crate::settings_pages::fresh_name(a),
        "displayCodeView" => crate::settings_pages::display_code(a),
        "mediaImportView" => crate::settings_pages::media_import(a),
        "storageLimitsView" => Ok(crate::settings_pages::storage_limits()),
        "deckImportView" => crate::settings_pages::deck_import(a),
        "libraryOrderView" => crate::settings_pages::library_order(a).await,
        "libraryPageView" => crate::library_pages::library_page(a),
        "videoImportView" => crate::settings_pages::video_import(a),
        "displayStatusView" => crate::settings_pages::display_status(a),
        "deckPagesView" => crate::settings_pages::deck_pages(a),
        "themesPageView" => crate::settings_pages::themes_page(a).await,
        "themeEditorView" => crate::theme_editor::view(a),
        "themeEditView" => crate::theme_editor::edit(a),
        "slideEditView" => crate::slide_editor::edit(a),
        "imageEditView" => crate::image_edit::view(a),
        "imageDrawView" => crate::image_edit::draw(a),
        "slideEditorView" => crate::slide_editor::view(a),
        "slideHitView" => crate::slide_editor::hit(a),
        "editorSlideView" => crate::slide_editor::slide(a),
        "labelColoursView" => Ok(crate::settings_pages::label_colours()),
        "slideMarksView" => crate::presenting::marks(a),
        "coreInfoView" => Ok(core_info()),
        "rulesView" => Ok(crate::mutators::rules()),
        "highlightView" => Ok(search::highlight(&s(a.get("text").unwrap_or(&Value::Null)), &s(a.get("query").unwrap_or(&Value::Null)))),
        "bibleSlidesView" => crate::bible::slides_view(a),
        "verseSearchPlanView" => crate::bible_books::plan_view(a),
        "bibleBookNamesView" => crate::bible_books::names_view(a),
        "proPresenterSongView" => crate::propresenter::view(a),
        "bibleImportView" => crate::bible_import::view(a),
        "legacyUpgradeView" => crate::legacy::upgrade_view(a),
        "legacyBlobsView" => crate::legacy::blobs_view(a),
        "legacyRowsProblemView" => crate::legacy::problem_view(a),
        "legacyOverlayPageView" => crate::legacy::overlay_page_view(a),
        "exportRowsView" => crate::legacy::export_rows().await,
        "exportPlanView" => crate::org_transfer::export_plan(a),
        "importManifestView" => crate::org_transfer::import_manifest(a),
        "importPlanView" => crate::org_transfer::import_plan(a),
        "songNamesakesView" => crate::song_import::namesakes(a),
        "songImportDuplicatesView" => crate::song_import::duplicates(a),
        #[cfg(feature = "layout")]
        "slideLayoutView" => crate::slide_layout::view(a),
        _ => return None,
    })
}

/// What the running core is, for Om Gospel Presenter: the crate's name and version, as built.
fn core_info() -> Value { json!({ "name": env!("CARGO_PKG_NAME"), "version": env!("CARGO_PKG_VERSION") }) }

/// The presentations, last changed first, with how many items each has.
async fn presentations() -> Value {
    let rows = sql(
        "SELECT p.id, p.name, p.event_date, p.time, p.location, (SELECT count(*) FROM presentation_items i WHERE i.presentation_id = p.id)
         FROM presentations p WHERE p.deleted_at IS NULL AND p.is_template = 0 ORDER BY p.updated_at DESC, p.name",
        vec![],
    ).await;
    Value::Array(rows.into_iter().map(|r| json!({
        "id": r[0], "name": r[1], "eventDate": r[2], "time": r[3], "location": r[4], "itemCount": r[5],
    })).collect())
}

/// The presentations in the trash, last trashed first.
async fn trash() -> Value {
    Value::Array(sql("SELECT id, name, deleted_at FROM presentations WHERE deleted_at IS NOT NULL AND is_template = 0 ORDER BY deleted_at DESC, name", vec![]).await
        .into_iter().map(|r| json!({ "id": r[0], "name": r[1], "deletedAt": r[2] })).collect())
}

/// Each item's id and how many slides it has, in the running order: what presenting steps through.
pub async fn steps(pid: &str) -> R<Vec<(String, usize)>> {
    let view = presentation(pid).await?;
    Ok(view["items"].as_array().unwrap().iter().map(|i| (s(&i["id"]), i["slides"].as_array().map_or(0, |a| a.len()))).collect())
}

/// A presentation's details, and its items in order, each with its slides.
pub async fn presentation(pid: &str) -> R<Value> {
    let p = sql("SELECT name, event_date, time, location, description FROM presentations WHERE id = ?", vec![json!(pid)]).await
        .into_iter().next().ok_or("not-found")?;
    let rows = sql("SELECT id, type, title, source_id, arrangement_id, content, note FROM presentation_items WHERE presentation_id = ? ORDER BY sort, id", vec![json!(pid)]).await;
    let items: Vec<crate::slides::Item> = rows.iter().map(|r| crate::slides::Item {
        kind: s(&r[1]), title: s(&r[2]), source_id: s(&r[3]), arrangement_id: r[4].as_str().map(String::from), content: r[5].as_str().map(String::from),
    }).collect();
    let slides = crate::slides::items_slides(&items).await;
    let mut out = Vec::new();
    for (r, mut shown) in rows.into_iter().zip(slides) {
        let kind = s(&r[1]);
        let arrangements = if kind == "song" {
            sql("SELECT id, name FROM song_arrangements WHERE song_id = ? ORDER BY sort, id", vec![r[3].clone()]).await
                .into_iter().map(|a| json!({ "id": a[0], "name": a[1] })).collect()
        } else { vec![] };
        let entry = shown.as_object_mut().unwrap();
        for (k, v) in [("id", r[0].clone()), ("type", json!(kind)), ("title", r[2].clone()), ("note", r[6].clone()), ("arrangementId", r[4].clone()), ("arrangements", Value::Array(arrangements))] {
            entry.insert(k.into(), v);
        }
        out.push(shown);
    }
    Ok(json!({ "id": pid, "name": p[0], "eventDate": p[1], "time": p[2], "location": p[3], "description": p[4], "items": out }))
}

/// `searchSongsView` {query, locale}: the library's songs for "Lägg till sång", best match first (search.rs), ties and
/// a blank query in the library's order: by name in the page's language, as `songsView` and the web's SongSearch have
/// it (the native app's add sheet; the web searches through `songSearchView`).
async fn songs(query: &str, lang: crate::collation::Lang) -> Value {
    let rows = sql("SELECT s.id, s.name, s.author, p.content FROM songs s LEFT JOIN song_parts p ON p.song_id = s.id
                    WHERE s.deleted_at IS NULL ORDER BY s.rowid, p.sort, p.id", vec![]).await;
    let mut library: Vec<(String, String, String, Vec<String>)> = Vec::new();
    for r in rows {
        if library.last().map(|l| l.0 != s(&r[0])).unwrap_or(true) { library.push((s(&r[0]), s(&r[1]), s(&r[2]), vec![])) }
        if let Some(text) = r[3].as_str() { library.last_mut().unwrap().3.push(text.to_string()) }
    }
    library.sort_by(|a, b| crate::collation::names(lang, &a.1, &b.1));
    let prepared: Vec<search::Prepared> = library.iter()
        .map(|(_, name, author, parts)| search::prepare(name, author, parts.first().map_or("", |p| p.as_str()), &parts.join("\n")))
        .collect();
    // With its author, which the list shows under the name, as the web's (SongTab.tsx).
    Value::Array(search::rank(&prepared, query).into_iter().take(50).map(|i| json!({ "id": library[i].0, "name": library[i].1, "author": library[i].2 })).collect())
}
