// What a page offers, worked out once for every shell (docs/view-models.md): where an addition goes, an item's menu,
// the presentation's menu, the start page's lists. Each was the web's own (apps/web/src) and is here as the web had it;
// the shells draw what these answer and decide none of it themselves.
use crate::args::*;
use serde_json::{json, Value};
use std::cmp::Ordering;

/// A string argument that JavaScript would take as given: empty and missing alike are "none" (`x ? … : …`).
fn given<'a>(a: &'a Obj, k: &str) -> Option<&'a str> { a.get(k).and_then(Value::as_str).filter(|s| !s.is_empty()) }

/// `addPositionView` {order, shownId, lastAddedId, chosenId, selectedId}: the item something added goes after, one rule
/// for every layout (Lars, 2026-11-18). The one chosen in an item's menu ("Lägg till efter"). While presenting (the
/// item on the outputs, black or not): the last thing added while it is still ahead of the shown item, so several additions
/// keep their order, else the shown item (liveList.ts's `addAfter`). With nothing shown: the selected item, as Keynote
/// adds after the selected slide, else the last thing added; a phone has no selection, so it adds after the last thing
/// added. Null: at the end. An id not in `order` (an item gone) counts as none.
pub fn add_position(a: &Obj) -> R<Value> {
    let order: Vec<&str> = a.get("order").and_then(Value::as_array).ok_or("invalid-args")?
        .iter().map(|v| v.as_str().ok_or_else(|| "invalid-args".to_string())).collect::<R<_>>()?;
    let here = |k: &str| given(a, k).filter(|id| order.contains(id));
    let at = |id: &str| order.iter().position(|o| *o == id);
    if let Some(chosen) = here("chosenId") { return Ok(json!(chosen)) }
    let last = here("lastAddedId");
    Ok(match here("shownId") {
        Some(shown) => json!(last.filter(|l| at(l) > at(shown)).unwrap_or(shown)),
        None => here("selectedId").or(last).map_or(Value::Null, |id| json!(id)),
    })
}

/// An action of a menu: its id, which the shell maps to what it does; its text's key in apps/web/src/i18n.ts; its icon
/// (`icon_of`); whether it may be done now (with the key of why not, as its text); red when it removes something.
fn action(id: &str, text: &str) -> Value { json!({ "id": id, "text": text, "icon": icon_of(id), "enabled": true, "destructive": false }) }

/// An action's or a button's icon, as the web draws it (ItemContextMenu.tsx, PresentationMenu.tsx, AddItemDialog.tsx,
/// PresentationBar.tsx), by a name of the app's own that each shell maps once to its platform's (SF Symbols on a Mac,
/// Heroicons on the web; Fluent and Adwaita after them): what the action is drawn as, not how (Lars, 2026-11-21).
fn icon_of(id: &str) -> &'static str {
    match id {
        "rename" | "edit" | "editImages" | "editDetails" => "edit",
        "note" => "comment",
        "arrangement" => "arrangement",
        "overlay" => "overlay",
        "addAfter" | "add" | "new" => "add",
        "tick" => "tick",
        "black" => "display",
        "delete" | "trash" => "delete",
        "materials" => "song",
        "saveAsTemplate" => "duplicate",
        "back" => "back",
        "start" => "play",
        "end" => "stop",
        "fold" => "sidebar",
        kind => kind_icon(kind),
    }
}

/// The kinds Lägg till offers, in the web's order (AddItemDialog.tsx's tabs, then Programpunkt apart, as the item's
/// Lägg till efter › has them): each its id, its text's key and its icon. A shell that cannot add a kind yet leaves it
/// out, and says so where it draws the menu.
const ADD_KINDS: [(&str, &str); 7] = [("song", "add.song"), ("bible", "add.bible"), ("image", "add.image"), ("audio", "presentation.audioTab"),
    ("video", "presentation.videoTab"), ("slides", "add.slides"), ("header", "header.kind")];

fn kind_icon(kind: &str) -> &'static str {
    match kind { "song" => "song", "bible" => "bible", "image" => "image", "audio" => "audio", "video" => "video", "slides" => "slides", "header" => "header", _ => "none" }
}

/// The kinds to add, as choices of Lägg till (efter) ›; Programpunkt in a group of its own, after a line.
fn add_kinds() -> Value {
    Value::Array(ADD_KINDS.iter().map(|(id, text)| json!({ "id": id, "text": text, "icon": kind_icon(id), "apart": *id == "header" })).collect())
}

fn group(id: &str, actions: Vec<Value>) -> Option<Value> { (!actions.is_empty()).then(|| json!({ "id": id, "actions": actions })) }

/// `presentationActionsView` {isTemplate, presenting, role}: the presentation's menu behind its title (the web's
/// PresentationMenu.tsx): Redigera detaljer… and, but for a template, Noter och länkar; Spara som mall… for one who may
/// manage templates, but for a template; and to the trash unless it is being presented. Groups apart, as Apple groups
/// a menu.
pub fn presentation_actions(a: &Obj) -> R<Value> {
    let template = a.get("isTemplate").and_then(Value::as_bool).ok_or("invalid-args")?;
    let presenting = a.get("presenting").and_then(Value::as_bool).ok_or("invalid-args")?;
    let role = a.get("role").and_then(Value::as_str).unwrap_or("");
    let mut details = vec![action("editDetails", "presentation.editDetailsMenu")];
    if !template { details.push(action("materials", "material.title")) }
    let save = if !template && crate::mutators::can(role, "ManageTemplates") { vec![action("saveAsTemplate", "templates.saveAsMenu")] } else { vec![] };
    let mut trash = action("trash", if template { "templates.trash" } else { "presentation.trash" });
    trash["destructive"] = json!(true);
    let remove = if presenting { vec![] } else { vec![trash] };
    let groups: Vec<Value> = [group("details", details), group("template", save), group("remove", remove)].into_iter().flatten().collect();
    Ok(json!({ "groups": groups }))
}

/// `itemActionsView` {item: {id, type, sourceId, arrangementId, overlayId}, song, arrangements, overlays, shownId}: an item's menu (the web's ItemContextMenu.tsx), the
/// same on its row, its heading's … and a phone's sheet: opening it (Byt namn for a programme item; Redigera for a song
/// not in the trash or a custom slide, the pictures for a picture item, each with where it `opens`) and Kommentar; Arrangemang › with two or more,
/// for a song not in the trash, and Överlägg › while there are overlays, for anything but a programme item; Lägg till
/// efter › and Markera (no "Ny programpunkt ovanför": Lars, 2026-11-18, spec 03 2d); and Radera, not for the item on the outputs. `song` is the item's song
/// (or null), `arrangements` its arrangements in their order, `overlays` the organisation's, `shownId` the item on the
/// outputs while presenting, black or not: removed after Släck, the next → would find it gone and start the running
/// order over from its first slide (Lars, 2026-11-18; packages/rust-core/test/scenarios).
pub fn item_actions(a: &Obj) -> R<Value> {
    let item = obj(a.get("item").ok_or("invalid-args")?)?;
    let kind = item.get("type").and_then(Value::as_str).unwrap_or("song");
    let id = item.get("id").and_then(Value::as_str).ok_or("invalid-args")?;
    let song_here = kind == "song" && a.get("song").is_some_and(|s| s.is_object() && s["deletedAt"].is_null());
    let list = |k: &str| a.get(k).and_then(Value::as_array).cloned().unwrap_or_default();
    let mut open = vec![];
    if kind == "header" { open.push(action("rename", "header.rename")) }
    // Where each leads (`opens`): a song's page, a custom slideshow's editor (docs/custom-slides.md), an image item's
    // pictures; `id` the song or slideshow (the item's `sourceId`) or the item.
    let source = item.get("sourceId").cloned().unwrap_or(Value::Null);
    if kind == "custom" || song_here {
        let mut edit = action("edit", "presentation.editSong");
        edit["opens"] = json!({ "page": if kind == "custom" { "customSlide" } else { "song" }, "id": source });
        open.push(edit);
    }
    if kind == "image" {
        let mut edit = action("editImages", "presentation.editImages");
        edit["opens"] = json!({ "page": "images", "id": id });
        open.push(edit);
    }
    open.push(action("note", "note.title"));
    let mut show = vec![];
    if kind != "header" {
        let arrangements = if song_here { list("arrangements") } else { vec![] };
        // Original first, the song's parts in their own order, beside an arrangement of its own (Lars, 2026-11-19).
        if !arrangements.is_empty() {
            let mut choices = vec![json!({ "id": crate::mutators::ORIGINAL, "text": "song.original" })];
            choices.extend(arrangements.iter().enumerate().map(|(n, x)| json!({ "id": x["id"], "name": x["name"], "n": n + 1 })));
            let chosen = item.get("arrangementId").filter(|v| v.is_string()).cloned().unwrap_or_else(|| arrangements[0]["id"].clone());
            let mut arr = action("arrangement", "song.arrangements");
            arr["choices"] = json!(choices);
            arr["chosen"] = chosen;
            show.push(arr);
        }
        let overlays = list("overlays");
        if !overlays.is_empty() {
            let mut choices = vec![json!({ "id": "", "text": "overlays.itemNone" })];
            choices.extend(overlays.iter().map(|o| json!({ "id": o["id"], "name": o["title"] })));
            let mut ov = action("overlay", "overlays.itemOverlay");
            ov["choices"] = json!(choices);
            ov["chosen"] = item.get("overlayId").filter(|v| v.is_string()).cloned().unwrap_or(json!(""));
            show.push(ov);
        }
    }
    let mut add_after = action("addAfter", "live.addAfter");
    add_after["choices"] = add_kinds();
    let listing = vec![add_after, action("tick", "presentation.tick")];
    let can = removable(id, given(a, "shownId"));
    let mut delete = action("delete", if can { "common.delete" } else { "live.shownCannotRemove" });
    delete["enabled"] = json!(can);
    delete["destructive"] = json!(true);
    let groups: Vec<Value> = [group("open", open), group("show", show), group("list", listing), group("remove", vec![delete])].into_iter().flatten().collect();
    Ok(json!({ "groups": groups }))
}

/// `detailsDialogView` {isNew}: a presentation's details dialog, as every shell draws it (the web's
/// PresentationDetailsDialog, the native DetailsSheet): its title ("Skapa presentation", or "Redigera detaljer" for
/// one there), its fields in their groups in order (the theme only for one there, chosen when it is edited), and its
/// buttons in order, each with its text's key and its role: Avbryt, then the confirming one, Skapa (Skapar… while it
/// works) for a new one, Spara for one there. Whether the confirming one may be pressed is the name's rule
/// (`rulesView`'s fields).
pub fn details_dialog(a: &Obj) -> R<Value> {
    let new = a.get("isNew").and_then(Value::as_bool).ok_or("invalid-args")?;
    let mut groups = vec![json!(["name", "location"]), json!(["date", "time"])];
    if !new { groups.push(json!(["theme"])) }
    groups.push(json!(["description"]));
    Ok(json!({
        "title": if new { "presentations.createTitle" } else { "presentation.editDetails" },
        "groups": groups,
        "actions": [
            { "id": "cancel", "text": "common.cancel", "role": "cancel" },
            { "id": "save", "text": if new { "common.create" } else { "common.save" }, "busyText": if new { json!("common.creating") } else { Value::Null }, "role": "confirm" },
        ],
    }))
}

/// A button of a page: its id, which the shell maps to what it does and to its icon; its text's key (said beside the
/// icon where there is room, else its label for a screen reader and its tooltip); its role (`lookView`'s roles, its
/// colour and weight); whether it may be pressed.
fn button(id: &str, text: &str, role: &str, enabled: bool) -> Value {
    json!({ "id": id, "text": text, "icon": icon_of(id), "role": role, "enabled": enabled })
}

/// `pageButtonsView` {place, presenting?, canStart?, hasSlides?, black?}: the buttons of a place in a page, in order, as
/// every shell draws them (Lars, 2026-11-21): `presentationBar` the way back and ▶ Starta (when `canStart`, the core's
/// `pageModelView`, and the presentation has a slide) or ■ Avsluta while presenting; `startPage` the + of its heading;
/// `runningOrder` Lägg till and folding the column; `liveColumn` Släck (not while `black`) and folding it. A shell may draw one it cannot do yet as
/// left out, and says so where it draws the place.
pub fn page_buttons(a: &Obj) -> R<Value> {
    let flag = |k: &str| a.get(k).and_then(Value::as_bool).unwrap_or(false);
    let buttons = match a.get("place").and_then(Value::as_str).ok_or("invalid-args")? {
        "presentationBar" => vec![
            button("back", "nav.backToPresentations", "quiet", true),
            if flag("presenting") { button("end", "live.end", "end", true) } else { button("start", "presentation.start", "start", flag("canStart") && flag("hasSlides")) },
        ],
        "startPage" => vec![button("new", "presentations.new", "add", true)],
        "runningOrder" => {
            let mut add = button("add", "live.add", "add", true);
            add["choices"] = add_kinds();
            vec![add, button("fold", "presentation.hideSidebar", "quiet", true)]
        }
        // Släck under the picture, which cannot be pressed while it is black already.
        // Lifted off the column as the web's (LivePicture.tsx `LIFTED`): a quiet button of the column's own.
        "liveColumn" => vec![button("black", "live.clear", "quiet", !flag("black")), button("fold", "presentation.hideLiveColumn", "quiet", true)],
        _ => return Err("invalid-args".into()),
    };
    Ok(json!({ "buttons": buttons }))
}

/// `presentationColumnsView` {presenting}: a presentation's side columns on a computer or an iPad lying down, as the
/// web's PresentationEditor.tsx, RunningOrder.tsx and LivePanel.tsx lay them out (Lars, 2026-11-21): each its side,
/// what it holds from the top (`parts`: a shell draws those it has, in this order, and nothing else), what its foot
/// holds (`foot`, from its outer edge to its inner one: the sync line or Fjärrstyrning at the outer, the window's, and
/// its fold button at the inner, beside the slides, as the web's SideMenu.tsx and LivePanel.tsx have them; Lars,
/// 2026-11-21), whether it is out (the live column only while presenting, and
/// out again at each start), its `width` in points (the web's pixels: `ideal`, and where it is `resizable` by dragging
/// its edge, within `min` and `max`; a platform whose columns are not, such as the web's, keeps the ideal), never
/// folded by that dragging (`foldsByDrag`: dragged past its least width beside the slides' scrollbar, it folded away by
/// mistake; Lars, 2026-11-21), and where a folded one's way back floats (at the foot of the slides, on its side). The
/// live column holds what is shown and Släck (`picture`), the outputs and the overlays: never the next slide (Lars,
/// 2026-11-21). `sticky` names the parts always within reach: each follows the parts above it while they fit, and
/// floats at the column's foot, over them, when they run past it (Lägg till, as the web's RunningOrder.tsx).
pub fn presentation_columns(a: &Obj) -> R<Value> {
    let presenting = a.get("presenting").and_then(Value::as_bool).ok_or("invalid-args")?;
    Ok(json!({ "columns": [
        { "id": "runningOrder", "side": "leading", "shown": true, "parts": ["description", "items", "add"], "sticky": ["add"],
          "foot": ["sync", "fold"], "foldEdge": "inner", "unfold": "slidesFoot", "outOnStart": false,
          "width": { "ideal": 300, "min": 240, "max": 420 }, "resizable": true, "foldsByDrag": false },
        { "id": "live", "side": "trailing", "shown": presenting, "parts": ["picture", "outputs", "overlays"], "sticky": [],
          "foot": ["remote", "fold"], "foldEdge": "inner", "unfold": "slidesFoot", "outOnStart": true,
          "width": { "ideal": 340, "min": 300, "max": 480 }, "resizable": true, "foldsByDrag": false },
    ] }))
}

/// Whether an item may be removed: not the one on the outputs (`shown`, black or not), whose removal would send the
/// next → back to the first slide. An item's menu (Radera) and the page's Delete key ask the same.
pub fn removable(item: &str, shown: Option<&str>) -> bool { shown != Some(item) }

/// Strings as JavaScript's `<` orders them: by UTF-16 code units.
fn js_cmp(a: &str, b: &str) -> Ordering { a.encode_utf16().cmp(b.encode_utf16()) }

fn text<'a>(p: &'a Value, k: &str) -> Option<&'a str> { p[k].as_str() }

/// `startPageView` {today}: the start page's lists (spec 03 screen 1, dashboard.ts's `groupPresentations`): Idag by
/// time (no time last), Kommande soonest first, and the rest, past and undated alike, last changed first; id last, so
/// the order is total. Each row is the presentation with its number of items (`itemCount`); each list says whether its
/// rows show their date and its year (Idag neither, Kommande the date, the rest both). An empty list is left out.
/// `today` is the device's date, `YYYY-MM-DD`.
pub async fn start_page(a: &Obj) -> R<Value> {
    let today = a.get("today").and_then(Value::as_str).ok_or("invalid-args")?.to_string();
    let Value::Array(mut all) = crate::lists::presentations().await? else { return Err("invalid-args".into()) };
    let counts = crate::lists::item_counts().await?;
    for p in all.iter_mut() {
        let n = counts.as_array().into_iter().flatten().find(|c| c[0] == p["id"]).map_or(json!(0), |c| c[1].clone());
        p["itemCount"] = n;
    }
    let time = |p: &Value| text(p, "time").unwrap_or("99:99").to_string();
    let changed = |p: &Value| p["updatedAt"].as_f64().unwrap_or(-1.0);
    let by_time = |a: &Value, b: &Value| time(a).cmp(&time(b));
    let by_changed = |a: &Value, b: &Value| changed(b).partial_cmp(&changed(a)).unwrap_or(Ordering::Equal);
    let by_id = |a: &Value, b: &Value| js_cmp(text(a, "id").unwrap_or(""), text(b, "id").unwrap_or(""));
    let date = |p: &Value| text(p, "eventDate").map(String::from);
    let mut day: Vec<Value> = all.iter().filter(|p| date(p).as_deref() == Some(today.as_str())).cloned().collect();
    day.sort_by(|a, b| by_time(a, b).then_with(|| by_changed(a, b)).then_with(|| by_id(a, b)));
    let mut upcoming: Vec<Value> = all.iter().filter(|p| date(p).is_some_and(|d| d.as_str() > today.as_str())).cloned().collect();
    upcoming.sort_by(|a, b| date(a).cmp(&date(b)).then_with(|| by_time(a, b)).then_with(|| by_id(a, b)));
    let mut rest: Vec<Value> = all.into_iter().filter(|p| date(p).is_none_or(|d| d.as_str() < today.as_str())).collect();
    rest.sort_by(|a, b| by_changed(a, b).then_with(|| by_id(a, b)));
    let lists = [("today", "presentations.today", false, false, day), ("upcoming", "presentations.upcoming", true, false, upcoming), ("recent", "presentations.recent", true, true, rest)];
    Ok(Value::Array(lists.into_iter().filter(|l| !l.4.is_empty()).map(|(id, title, show_date, with_year, rows)| {
        json!({ "id": id, "title": title, "showDate": show_date, "withYear": with_year, "rows": rows })
    }).collect()))
}
