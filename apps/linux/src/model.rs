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
    pub fn new(app: App) -> Model { Model { app, pages: HashMap::new(), layouts: HashMap::new() } }

    /// Every page and layout read again from the core when next painted: after a change of the data.
    pub fn forget(&mut self) {
        self.pages.clear();
        self.layouts.clear();
    }

    fn page(&mut self, id: &str) -> &Value {
        let core = self.app.core();
        self.pages.entry(id.to_string()).or_insert_with(|| core.call("presentationPageView", json!({ "id": id })).unwrap_or(Value::Null))
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

    /// A view of the page's own: pageButtonsView for `place`, given whether ▶ may start (pageModelView's `canStart`),
    /// whether the page has a slide, and the live state; presentationColumnsView's columns.
    pub fn buttons(&self, place: &str) -> Vec<Value> {
        let app = &self.app;
        let Some(page) = app.page.as_ref() else { return vec![] };
        let args = json!({ "state": app.state, "context": app.context(), "order": page.order() });
        let can_start = app.core().call("pageModelView", args).ok().and_then(|m| m["canStart"].as_bool()).unwrap_or(false);
        let has_slides = page.items.iter().any(|i| !page.slides_of(&i.id).is_empty());
        let args = json!({ "place": place, "presenting": app.is_live(), "canStart": can_start, "hasSlides": has_slides, "black": app.live.black });
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
