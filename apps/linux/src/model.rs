// What the window holds, over the terminal shell's App (crates/gp-tui/src/app.rs): the start page's lists, the page
// open and its own state, the app's live state, each changed only by the core as there. Beside it what slides need to
// be painted: each presentation's page as the core gave it (its theme, each slide whole, its overlays) and each slide's
// layout (slideLayoutView), kept until a change reads the page again.
use crate::layout::SlideLayout;
use crate::painter::Label;
use gp_tui::app::App;
use gp_tui::views::SlideAt;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::rc::Rc;

pub struct Model {
    pub app: App,
    /// Markera's select mode while it is on, as the core answers it (`tickView`).
    pub ticking: Option<Value>,
    /// presentationPageView's answer whole, by the presentation's id.
    pages: HashMap<String, Value>,
    /// slideLayoutView's answer by the slide's place (presentation, item, part); None where the core refused it.
    layouts: HashMap<(String, String, i64), Option<Rc<SlideLayout>>>,
}

/// A slide to paint: its layout, and its label on a tile.
pub struct Painted {
    pub layout: Option<Rc<SlideLayout>>,
    pub label: Option<Label>,
}

impl Model {
    pub fn new(app: App) -> Model { Model { app, ticking: None, pages: HashMap::new(), layouts: HashMap::new() } }

    /// Every page and layout read again from the core when next painted: after a change of the data.
    pub fn forget(&mut self) {
        self.pages.clear();
        self.layouts.clear();
    }

    fn page(&mut self, id: &str) -> &Value {
        let core = self.app.core();
        self.pages.entry(id.to_string()).or_insert_with(|| core.call("presentationPageView", json!({ "id": id })).unwrap_or(Value::Null))
    }

    /// The overlays a presentation offers while it is presented (Visning's switches): each one's id and title.
    pub fn overlays(&mut self, pid: &str) -> Vec<(String, String)> {
        self.page(pid)["overlays"].as_array().into_iter().flatten()
            .filter_map(|o| Some((o["id"].as_str()?.to_string(), o["title"].as_str().unwrap_or("").to_string()))).collect()
    }

    /// The slide at `at` of presentation `pid`, laid out by the core with its presentation's theme and its item's
    /// overlay, as the Mac app's TileRequest asks for it.
    pub fn painted(&mut self, pid: &str, at: &SlideAt) -> Painted {
        let page = self.page(pid).clone();
        let slide = &page["slides"][&at.item_id]["slides"][at.part_index as usize];
        let label = slide["label"]["text"].as_str().zip(slide["label"]["color"].as_str())
            .map(|(text, color)| Label { text: text.into(), color: color.into() });
        let key = (pid.to_string(), at.item_id.clone(), at.part_index);
        if let Some(layout) = self.layouts.get(&key) { return Painted { layout: layout.clone(), label } }
        let item = page["items"].as_array().into_iter().flatten().find(|i| i["id"] == json!(at.item_id));
        let overlay = item.and_then(|i| i["overlayId"].as_str())
            .and_then(|o| page["overlays"].as_array().into_iter().flatten().find(|v| v["id"] == json!(o)).cloned())
            .unwrap_or(Value::Null);
        let args = json!({ "slide": slide, "theme": page["theme"], "overlay": overlay });
        let layout = if slide.is_null() { None } else {
            self.app.core().call("slideLayoutView", args).ok().and_then(|v| serde_json::from_value(v).ok()).map(Rc::new)
        };
        self.layouts.insert(key, layout.clone());
        Painted { layout, label }
    }

    /// A slide not in a page (a preview of one to add), laid out by the core in the open presentation's theme.
    pub fn preview_layout(&mut self, slide: &Value) -> Option<Rc<SlideLayout>> {
        let pid = self.app.open_id()?.to_string();
        let theme = self.page(&pid)["theme"].clone();
        self.app.core().call("slideLayoutView", json!({ "slide": slide, "theme": theme, "overlay": null })).ok()
            .and_then(|v| serde_json::from_value(v).ok()).map(Rc::new)
    }

    /// The item shown while the open page is presented, black or not: it cannot be removed nor ticked.
    fn shown_id(&self) -> Value { if self.app.is_live() { json!(self.app.live.item_id) } else { Value::Null } }

    /// An item's menu, the core's (`itemActionsView`): its groups, from the item, its song, the song's arrangements,
    /// the organisation's overlays and the item shown, as the Mac app's `itemActions` gives them.
    pub fn item_actions(&mut self, item_id: &str) -> Vec<Value> {
        let Some(pid) = self.app.open_id().map(String::from) else { return vec![] };
        let shown = self.shown_id();
        let page = self.page(&pid).clone();
        let Some(item) = page["items"].as_array().into_iter().flatten().find(|i| i["id"] == json!(item_id)).cloned() else { return vec![] };
        let song_item = item["type"] == json!("song");
        let song = if song_item { page["songs"].as_array().into_iter().flatten().find(|s| s["id"] == item["sourceId"]).cloned() } else { None };
        let arrangements: Vec<Value> = if song_item {
            page["arrangements"].as_array().into_iter().flatten().filter(|a| a["songId"] == item["sourceId"])
                .map(|a| json!({ "id": a["id"], "name": a["name"] })).collect()
        } else { vec![] };
        let args = json!({
            "item": { "id": item["id"], "type": item["type"], "sourceId": item["sourceId"], "arrangementId": item["arrangementId"], "overlayId": item["overlayId"] },
            "song": song, "arrangements": arrangements, "overlays": page["overlays"], "shownId": shown,
        });
        self.app.core().call("itemActionsView", args).ok().and_then(|v| v["groups"].as_array().cloned()).unwrap_or_default()
    }

    /// An item's own field as the page has it (its title, its comment).
    pub fn item_field(&mut self, item_id: &str, field: &str) -> String {
        let Some(pid) = self.app.open_id().map(String::from) else { return String::new() };
        let page = self.page(&pid);
        page["items"].as_array().into_iter().flatten().find(|i| i["id"] == json!(item_id))
            .and_then(|i| i[field].as_str()).unwrap_or_default().to_string()
    }

    /// Select mode after `event` (None: as it stands, the order or the item shown changed), by the core's rule
    /// (`tickView`); off it stays off.
    pub fn tick(&mut self, event: Option<Value>) {
        let order: Vec<String> = self.app.page.as_ref().map(|p| p.items.iter().map(|i| i.id.clone()).collect()).unwrap_or_default();
        let from = self.ticking.clone().unwrap_or(Value::Null);
        if from.is_null() && event.as_ref().is_none_or(|e| e["type"] != json!("start")) { return }
        let mut args = json!({ "order": order, "shownId": self.shown_id(), "ticked": from["ticked"], "last": from["last"] });
        if let Some(event) = event { args["event"] = event }
        self.ticking = self.app.core().call("tickView", args).ok();
    }

    /// pageButtonsView for `place`, given whether ▶ may start (the last step's `canStart`), whether the page has a
    /// slide, and the live state.
    pub fn buttons(&self, place: &str) -> Vec<Value> {
        let app = &self.app;
        let Some(page) = app.page.as_ref() else { return vec![] };
        let has_slides = page.items.iter().any(|i| !page.slides_of(&i.id).is_empty());
        let args = json!({ "place": place, "presenting": app.is_live(), "canStart": app.can_start, "hasSlides": has_slides, "black": app.live.black });
        app.core().call("pageButtonsView", args).ok().and_then(|v| v["buttons"].as_array().cloned()).unwrap_or_default()
    }

    /// The side column `id` of presentationColumnsView: whether it is out, and its ideal width.
    pub fn column(&self, id: &str) -> (bool, i32) {
        let columns = self.app.core().call("presentationColumnsView", json!({ "presenting": self.app.is_live() })).unwrap_or(Value::Null);
        let c = columns["columns"].as_array().into_iter().flatten().find(|c| c["id"] == json!(id)).cloned().unwrap_or(Value::Null);
        (c["shown"].as_bool().unwrap_or(false), c["width"]["ideal"].as_i64().unwrap_or(300) as i32)
    }

    /// What the outputs show: the slide presented, none before the first slide and after Släck.
    pub fn shown(&mut self) -> Option<Painted> {
        let live = self.app.live.clone();
        let (pid, item_id) = (live.presentation_id?, live.item_id?);
        if live.black { return None }
        Some(self.painted(&pid, &SlideAt { item_id, part_index: live.part_index }))
    }
}
