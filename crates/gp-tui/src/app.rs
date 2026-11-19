// What the terminal shows and holds, as the Mac app's AppState, Model and Live do (apps/mac/Sources/GPMac): the start
// page's lists, the presentation open and its page's own state, and the app's live state with its marks. Each is
// changed only by the core: the page's state by `pageEventView`, the live state by `liveChangeView`; the shell sends
// events and keeps the answers.
use crate::keys::{self, Action};
use crate::shell::Core;
use crate::views::*;
use ratatui::crossterm::event::KeyEvent;
use serde_json::{json, Value};

/// Where the terminal is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Screen {
    Start,
    Page,
    /// What the outputs show, filling the terminal (the Mac's output window).
    Output,
}

pub struct App {
    core: Core,
    /// The device's date, `YYYY-MM-DD`, for the start page's lists.
    pub today: String,
    pub screen: Screen,
    /// The start page's lists, as the core groups them, and the row the cursor is on, counted over all lists.
    pub lists: Vec<StartList>,
    pub cursor: usize,
    /// The presentation open, as `presentationPageView` reads it, and its page's own state.
    pub page: Option<PresentationPage>,
    pub state: PageState,
    /// The app's live state, its presented page and the marks VISAS and NÄSTA on it.
    pub live: LivePointer,
    pub live_page: Option<PresentationPage>,
    pub marks: SlideMarks,
    /// The cue over the live picture, as `pageModelView` gives it.
    pub cue: Option<Cue>,
    /// The question to end presenting, open.
    pub ending: bool,
    /// What the core last refused, said in the footer.
    pub refusal: Option<String>,
    pub quit: bool,
}

impl App {
    pub fn new(core: Core, today: String) -> App {
        let mut app = App {
            core, today, screen: Screen::Start, lists: vec![], cursor: 0, page: None, state: PageState::default(),
            live: LivePointer::default(), live_page: None, marks: SlideMarks::default(), cue: None, ending: false,
            refusal: None, quit: false,
        };
        app.load_start();
        app
    }

    pub fn load_start(&mut self) {
        self.lists = self.core.view("startPageView", json!({ "today": self.today })).unwrap_or_default();
        self.cursor = self.cursor.min(self.rows().len().saturating_sub(1));
    }

    /// The start page's rows in the order drawn.
    pub fn rows(&self) -> Vec<&PresentationRow> { self.lists.iter().flat_map(|l| &l.rows).collect() }

    fn read_page(&self, id: &str) -> Option<PresentationPage> {
        self.core.view::<PresentationPage>("presentationPageView", json!({ "id": id })).filter(|p| p.presentation.is_some())
    }

    pub fn open_id(&self) -> Option<&str> { self.page.as_ref().and_then(|p| p.presentation.as_ref()).map(|p| p.id.as_str()) }

    /// The open presentation is the one presented.
    pub fn is_live(&self) -> bool { self.live.presentation_id.is_some() && self.live.presentation_id.as_deref() == self.open_id() }

    /// A presentation opened: its page's state starts afresh, the item shown selected if it is the one presented.
    pub fn open(&mut self, id: &str) {
        self.page = self.read_page(id);
        let presenting = self.live.presentation_id.as_deref() == Some(id);
        let shown = if presenting { self.live.item_id.clone() } else { None };
        self.state = PageState { selected_id: shown.clone(), presenting, followed: shown, ..PageState::default() };
        self.screen = Screen::Page;
        self.refusal = None;
        self.model();
    }

    /// A key, as the screen it is pressed on takes it.
    pub fn key(&mut self, key: KeyEvent) {
        let action = if self.ending { keys::confirm_key(key) } else {
            match self.screen {
                Screen::Start => keys::start_key(key),
                Screen::Page => keys::page_key(key),
                Screen::Output => keys::output_key(key),
            }
        };
        if let Some(action) = action { self.act(action) }
    }

    pub fn act(&mut self, action: Action) {
        match action {
            Action::Quit => self.quit = true,
            Action::Move(by) => {
                let n = self.rows().len() as i64;
                if n > 0 { self.cursor = (self.cursor as i64 + by).clamp(0, n - 1) as usize }
            }
            Action::Open => if let Some(id) = self.rows().get(self.cursor).map(|r| r.id.clone()) { self.open(&id) },
            Action::Back => self.back(),
            Action::Output => self.screen = if self.screen == Screen::Output { Screen::Page } else { Screen::Output },
            Action::Confirm(yes) => {
                self.ending = false;
                if yes { self.end() }
            }
            Action::Event(event) => {
                let escape = event["type"] == "escape";
                let answer = self.send(event);
                // Esc that the page did not take goes back to the start page, but never from the page presented.
                if escape && self.screen == Screen::Page && !self.is_live() && answer.as_ref().is_some_and(|a| !a.handled) { self.back() }
                if let Some(command) = answer.map(|a| a.command) { self.perform(&command) }
            }
        }
    }

    /// Back to the start page: what is presented goes on.
    fn back(&mut self) {
        self.screen = Screen::Start;
        self.page = None;
        self.load_start();
    }

    fn context(&self) -> Value {
        let template = self.page.as_ref().and_then(|p| p.presentation.as_ref()).is_some_and(|p| p.is_template);
        json!({ "presentationId": self.open_id(), "isTemplate": template, "presenting": self.is_live(), "live": self.live })
    }

    /// An event of the open page, as the core answers it (`pageEventView`): its state kept, its change to the live
    /// state made, and then what that change leaves the page in (`sync`). Model.send in the Mac app.
    pub fn send(&mut self, event: Value) -> Option<PageAnswer> {
        let order = self.page.as_ref()?.order();
        let args = json!({ "state": self.state, "context": self.context(), "order": order, "event": event });
        let answer: PageAnswer = match self.core.call("pageEventView", args) {
            Ok(v) => serde_json::from_value(v).ok()?,
            Err(code) => { self.refusal = Some(code); return None }
        };
        self.state = answer.state.clone();
        if answer.live.is_object() && self.set_live(answer.live.clone()) { self.live_changed() }
        self.model();
        Some(answer)
    }

    /// What the core's answer asks of the page: a move, or the question to end. Adding and removing are not in this
    /// shell yet (docs/tui.md).
    fn perform(&mut self, command: &Value) {
        match command["type"].as_str() {
            Some("move") => {
                let args = json!({ "itemId": command["itemId"], "by": command["by"] });
                if let Err(code) = self.core.command("moveItem", args) { self.refusal = Some(code) }
                self.changed();
            }
            Some("end") => self.ending = true,
            _ => {}
        }
    }

    /// The page and the live page read again after a change; the page told it was read again (`changed`), with the
    /// item selected as the one on the screen.
    fn changed(&mut self) {
        if let Some(id) = self.open_id().map(String::from) { self.page = self.read_page(&id) }
        if let Some(id) = self.live.presentation_id.clone() { self.live_page = self.read_page(&id) }
        let on_screen: Vec<Value> = self.state.selected_id.iter().map(|s| json!(s)).collect();
        self.send(json!({ "type": "changed", "itemIds": on_screen }));
        self.marks();
    }

    /// A change of the live state as the core makes it (`liveChangeView`): false when it refused. Live.set in the Mac app.
    pub fn set_live(&mut self, change: Value) -> bool {
        let starting = change["presentationId"].as_str().map(String::from);
        let fresh = starting.as_deref().filter(|id| Some(*id) != self.live.presentation_id.as_deref()).and_then(|id| self.read_page(id));
        let items = fresh.as_ref().or(self.live_page.as_ref()).map(|p| p.items.clone()).unwrap_or_default();
        let overlays: serde_json::Map<String, Value> = items.iter().map(|i| (i.id.clone(), json!(i.overlay_id))).collect();
        let args = json!({ "pointer": self.live, "change": change, "overlays": overlays });
        let Some(next) = self.core.call("liveChangeView", args).ok().and_then(|v| serde_json::from_value::<LivePointer>(v["pointer"].clone()).ok()) else {
            self.refusal = Some("another-presented".into());
            return false;
        };
        if next.presentation_id != self.live.presentation_id {
            self.live_page = fresh.or_else(|| next.presentation_id.as_deref().and_then(|id| self.read_page(id)));
        }
        self.live = next;
        self.marks();
        true
    }

    /// The live state changed: the open page as that leaves it (presenting started or ended).
    fn live_changed(&mut self) {
        let order = match &self.page { Some(p) => p.order(), None => return };
        let args = json!({ "state": self.state, "context": self.context(), "order": order, "event": { "type": "sync" } });
        if let Some(answer) = self.core.view::<PageAnswer>("pageEventView", args) { self.state = answer.state }
    }

    /// Avsluta: nothing presented, and the page as that leaves it.
    pub fn end(&mut self) {
        self.set_live(json!({ "presentationId": null, "itemId": null, "partIndex": 0, "black": false }));
        self.live_changed();
        self.model();
        if self.screen == Screen::Output { self.screen = Screen::Page }
    }

    fn marks(&mut self) {
        self.marks = match (&self.live.presentation_id, &self.live_page) {
            (Some(_), Some(page)) => {
                let shown = json!({ "itemId": self.live.item_id, "partIndex": self.live.part_index, "black": self.live.black });
                self.core.view("slideMarksView", json!({ "order": page.order(), "shown": shown })).unwrap_or_default()
            }
            _ => SlideMarks::default(),
        };
    }

    /// The cue from `pageModelView`, read after every event.
    fn model(&mut self) {
        let Some(order) = self.page.as_ref().map(PresentationPage::order) else { self.cue = None; return };
        let args = json!({ "state": self.state, "context": self.context(), "order": order });
        self.cue = self.core.view::<PageModel>("pageModelView", args).and_then(|m| m.cue);
    }

    /// What the outputs show: nothing before presenting, before the first slide and after Släck.
    pub fn shown_slide(&self) -> Option<(&PageItem, &Slide)> {
        if self.live.black { return None }
        let page = self.live_page.as_ref()?;
        let at = SlideAt { item_id: self.live.item_id.clone()?, part_index: self.live.part_index };
        Some((page.item(&at.item_id)?, page.slide(&at)?))
    }

    /// The slide marked NÄSTA, on the presented page.
    pub fn next_slide(&self) -> Option<(&PageItem, &Slide)> {
        let page = self.live_page.as_ref()?;
        let at = self.marks.next.as_ref()?.at()?;
        Some((page.item(&at.item_id)?, page.slide(&at)?))
    }
}
