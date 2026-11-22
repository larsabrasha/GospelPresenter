// What the terminal shows and holds, as the Mac app's AppState, Model and Live do (apps/mac/Sources/GPMac): the start
// page's lists, the presentation open and its page's own state, and the app's live state with its marks. Each is
// changed only by the core: the page's state by `pageEventView`, the live state by `liveChangeView`; the shell sends
// events and keeps the answers.
use crate::keys::{self, Action, Pane};
use crate::shell::Core;
use crate::views::*;
use ratatui::crossterm::event::KeyEvent;
use serde_json::{json, Value};
use std::cell::Cell;

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
    /// The cue over the live picture, and whether ▶ may start, as the last step gave them.
    pub cue: Option<Cue>,
    pub can_start: bool,
    /// The question to end presenting, open.
    pub ending: bool,
    /// What the core last refused, said in the footer.
    pub refusal: Option<String>,
    pub quit: bool,
    /// Where each list stands, by `Pane` (panes.rs): set by drawing while it follows its focus, by the wheel otherwise.
    pub offsets: [Cell<u16>; 4],
    /// Whether each list follows its focus: until the wheel moves it, and again from the next key or click.
    pub follow: [bool; 4],
}

impl App {
    pub fn new(core: Core, today: String) -> App {
        let mut app = App {
            core, today, screen: Screen::Start, lists: vec![], cursor: 0, page: None, state: PageState::default(),
            live: LivePointer::default(), live_page: None, marks: SlideMarks::default(), cue: None, can_start: false, ending: false,
            refusal: None, quit: false, offsets: Default::default(), follow: [true; 4],
        };
        app.load_start();
        app
    }

    /// The core, for the views another shell over this App reads itself (the Linux app's slide layouts).
    pub fn core(&self) -> &Core { &self.core }

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
        self.rewind();
        self.send(json!({ "type": "sync" }));
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
        self.follow = [true; 4];
        if let Some(action) = action { self.act(action) }
    }

    /// A click on what drawing recorded there (ui.rs, `target_at`). None while the question to end is open.
    pub fn click(&mut self, target: &keys::Target) {
        if self.ending { return }
        self.follow = [true; 4];
        if let Some(action) = keys::click(target) { self.act(action) }
    }

    /// The wheel, or a swipe a terminal sends as the wheel, over a list: it moves by `lines` and stops following its
    /// focus until the next key or click.
    pub fn wheel(&mut self, pane: Pane, lines: i32) {
        let at = &self.offsets[pane as usize];
        at.set((at.get() as i32 + lines).clamp(0, u16::MAX as i32) as u16);
        self.follow[pane as usize] = false;
    }

    /// The lists from their top, following their focus, as a page opened or left starts.
    fn rewind(&mut self) {
        for at in &self.offsets { at.set(0) }
        self.follow = [true; 4];
    }

    pub fn act(&mut self, action: Action) {
        match action {
            Action::Quit => self.quit = true,
            Action::Move(by) => {
                let n = self.rows().len() as i64;
                if n > 0 { self.cursor = (self.cursor as i64 + by).clamp(0, n - 1) as usize }
            }
            Action::Open => self.act(Action::OpenRow(self.cursor)),
            Action::OpenRow(n) => if let Some(id) = self.rows().get(n).map(|r| r.id.clone()) {
                self.cursor = n;
                self.open(&id);
            },
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
        self.rewind();
        self.load_start();
    }

    /// An event of the open page (`event`), or a change of the live state made outside its keys (`change`), carried
    /// through by the core in one step (`pageStepView`): the page's state, the live state with the overlays' rules,
    /// the marks, the cue and whether ▶ may start, each kept as it answers.
    fn step(&mut self, what: &str, value: Value) -> Option<PageStep> {
        let page = self.page.as_ref()?;
        let template = page.presentation.as_ref().is_some_and(|p| p.is_template);
        let mut args = json!({
            "state": self.state, "context": { "presentationId": self.open_id(), "isTemplate": template },
            "live": self.live, "order": page.order(), "overlays": page.overlays(),
        });
        // The presented page, where it is another than the one open: its marks are read from its own order.
        if let Some(other) = self.live_page.as_ref().filter(|p| p.presentation.as_ref().map(|r| r.id.as_str()) != self.open_id()) {
            args["liveOrder"] = other.order();
            args["liveOverlays"] = other.overlays();
        }
        args[what] = value;
        let step: PageStep = match self.core.call("pageStepView", args) {
            Ok(v) => serde_json::from_value(v).ok()?,
            Err(code) => { self.refusal = Some(code); return None }
        };
        if let Some(refused) = &step.refused { self.refusal = Some(refused.clone()) }
        if step.live.presentation_id != self.live.presentation_id {
            let id = step.live.presentation_id.clone();
            self.live_page = id.and_then(|id| if Some(id.as_str()) == self.open_id() { self.page.clone() } else { self.read_page(&id) });
        }
        (self.state, self.live, self.marks) = (step.state.clone(), step.live.clone(), step.marks.clone().unwrap_or_default());
        (self.cue, self.can_start) = (step.cue.clone(), step.can_start);
        Some(step)
    }

    /// An event of the open page, as the core answers it. Model.send in the Mac app.
    pub fn send(&mut self, event: Value) -> Option<PageStep> { self.step("event", event) }

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

    /// A command of the core's (a mutation), then the pages read again; whether it was done, its refusal kept.
    pub fn run(&mut self, name: &str, args: Value) -> bool {
        let done = match self.core.command(name, args) {
            Ok(_) => true,
            Err(code) => { self.refusal = Some(code); false }
        };
        self.changed();
        done
    }

    /// The page and the live page read again after a change; the page told it was read again (`changed`), with the
    /// item selected as the one on the screen.
    fn changed(&mut self) {
        if let Some(id) = self.open_id().map(String::from) { self.page = self.read_page(&id) }
        if let Some(id) = self.live.presentation_id.clone() { self.live_page = self.read_page(&id) }
        let on_screen: Vec<Value> = self.state.selected_id.iter().map(|s| json!(s)).collect();
        self.send(json!({ "type": "changed", "itemIds": on_screen }));
    }

    /// Avsluta: nothing presented, and the page as that leaves it.
    pub fn end(&mut self) {
        self.step("change", json!({ "presentationId": null, "itemId": null, "partIndex": 0, "black": false }));
        if self.screen == Screen::Output { self.screen = Screen::Page }
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
