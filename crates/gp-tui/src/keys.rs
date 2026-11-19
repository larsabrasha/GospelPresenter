// Which physical key is which event: the shell's (docs/view-models.md, "What stays a shell's"). What an event does is
// the core's (`pageEventView`). The page's keys are the Mac app's (apps/mac/Sources/GPMac/WideLayout.swift), the output
// view's its output window's (Slides.swift); a terminal has no ⌘, so ⇧↑ ⇧↓ take ⌘↑ ⌘↓'s place, and `e` asks to end as
// ⌘. does.
use crate::views::SlideAt;
use ratatui::crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use serde_json::{json, Value};

/// What a key asks of the shell on a page.
#[derive(Debug, Clone, PartialEq)]
pub enum Action {
    /// An event for the core.
    Event(Value),
    /// Leave the app.
    Quit,
    /// Back to the start page.
    Back,
    /// The output view on, or off.
    Output,
    /// The start page: the cursor up or down (the shell's own list), the row under it opened, or a row opened by a click.
    Move(i64),
    Open,
    OpenRow(usize),
    /// The question to end answered: yes or no.
    Confirm(bool),
}

fn event(v: Value) -> Option<Action> { Some(Action::Event(v)) }

/// What a click can hit, as drawing records it (ui.rs, `Hits`).
#[derive(Debug, Clone, PartialEq)]
pub enum Target {
    /// A start page row, counted over all its lists.
    Row(usize),
    /// An item of the running order.
    Item(String),
    /// A slide of the item shown.
    Slide(SlideAt),
}

/// A click, as the Mac app's taps take it: a row opened; an item chosen (`select`); a slide tapped (`show`: shown while
/// presenting, else made ready, as the core decides).
pub fn click(target: &Target) -> Option<Action> {
    match target {
        Target::Row(n) => Some(Action::OpenRow(*n)),
        Target::Item(id) => event(json!({ "type": "select", "itemId": id })),
        Target::Slide(at) => event(json!({ "type": "show", "itemId": at.item_id, "partIndex": at.part_index })),
    }
}

/// A key on the start page.
pub fn start_key(key: KeyEvent) -> Option<Action> {
    match key.code {
        KeyCode::Up | KeyCode::Char('k') => Some(Action::Move(-1)),
        KeyCode::Down | KeyCode::Char('j') => Some(Action::Move(1)),
        KeyCode::Enter => Some(Action::Open),
        KeyCode::Char('q') => Some(Action::Quit),
        _ => quit(key),
    }
}

/// A key on a presentation's page: the Mac app's page keys, each its event of `pageEventView`.
pub fn page_key(key: KeyEvent) -> Option<Action> {
    let shift = key.modifiers.contains(KeyModifiers::SHIFT);
    let alt = key.modifiers.contains(KeyModifiers::ALT);
    match key.code {
        KeyCode::Down | KeyCode::Right if shift => event(json!({ "type": "item", "delta": 1 })),
        KeyCode::Up | KeyCode::Left if shift => event(json!({ "type": "item", "delta": -1 })),
        KeyCode::Up if alt => event(json!({ "type": "move", "delta": -1 })),
        KeyCode::Down if alt => event(json!({ "type": "move", "delta": 1 })),
        KeyCode::Right | KeyCode::Down => event(json!({ "type": "pick", "delta": 1 })),
        KeyCode::Left | KeyCode::Up => event(json!({ "type": "pick", "delta": -1 })),
        KeyCode::PageDown => event(json!({ "type": "clicker", "delta": 1 })),
        KeyCode::PageUp => event(json!({ "type": "clicker", "delta": -1 })),
        KeyCode::Enter => event(json!({ "type": "enter", "onPage": true })),
        KeyCode::Char(' ') => event(json!({ "type": "step", "delta": 1 })),
        KeyCode::Esc => event(json!({ "type": "escape" })),
        KeyCode::Char('b' | 'B' | '.') => event(json!({ "type": "black" })),
        KeyCode::F(5) => event(json!({ "type": "start" })),
        KeyCode::Char('e') => event(json!({ "type": "end" })),
        KeyCode::Char(c @ '0'..='9') => event(json!({ "type": "digit", "digit": c.to_digit(10) })),
        KeyCode::Char('o') | KeyCode::Tab => Some(Action::Output),
        KeyCode::Char('q') => Some(Action::Quit),
        KeyCode::Backspace => Some(Action::Back),
        _ => quit(key),
    }
}

/// A key in the output view: the Mac's output window's, which step what is shown and black it.
pub fn output_key(key: KeyEvent) -> Option<Action> {
    match key.code {
        KeyCode::Right | KeyCode::Char(' ') | KeyCode::Enter => event(json!({ "type": "step", "delta": 1 })),
        KeyCode::Left => event(json!({ "type": "step", "delta": -1 })),
        KeyCode::Char('b' | 'B') => event(json!({ "type": "black" })),
        KeyCode::Char('o') | KeyCode::Tab | KeyCode::Esc => Some(Action::Output),
        KeyCode::Char('q') => Some(Action::Quit),
        _ => quit(key),
    }
}

/// A key while the question to end is open: ↵ or y ends, Esc or n does not.
pub fn confirm_key(key: KeyEvent) -> Option<Action> {
    match key.code {
        KeyCode::Enter | KeyCode::Char('y' | 'j') => Some(Action::Confirm(true)),
        KeyCode::Esc | KeyCode::Char('n') => Some(Action::Confirm(false)),
        _ => quit(key),
    }
}

/// ⌃C leaves from anywhere.
fn quit(key: KeyEvent) -> Option<Action> {
    (key.code == KeyCode::Char('c') && key.modifiers.contains(KeyModifiers::CONTROL)).then_some(Action::Quit)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn press(code: KeyCode) -> KeyEvent { KeyEvent::new(code, KeyModifiers::NONE) }
    fn with(code: KeyCode, m: KeyModifiers) -> KeyEvent { KeyEvent::new(code, m) }

    #[test]
    fn right_on_the_page_makes_the_next_slide_ready() {
        // Arrange, Act
        let action = page_key(press(KeyCode::Right));

        // Assert
        assert_eq!(action, Some(Action::Event(json!({ "type": "pick", "delta": 1 }))));
    }

    #[test]
    fn space_on_the_page_steps_forward() {
        // Arrange, Act
        let action = page_key(press(KeyCode::Char(' ')));

        // Assert
        assert_eq!(action, Some(Action::Event(json!({ "type": "step", "delta": 1 }))));
    }

    #[test]
    fn enter_on_the_page_is_the_pages_own() {
        // Arrange, Act
        let action = page_key(press(KeyCode::Enter));

        // Assert
        assert_eq!(action, Some(Action::Event(json!({ "type": "enter", "onPage": true }))));
    }

    #[test]
    fn b_and_full_stop_black_the_screen() {
        // Arrange, Act
        let actions = [page_key(press(KeyCode::Char('b'))), page_key(press(KeyCode::Char('B'))), page_key(press(KeyCode::Char('.')))];

        // Assert
        for a in actions { assert_eq!(a, Some(Action::Event(json!({ "type": "black" })))) }
    }

    #[test]
    fn f5_starts() {
        // Arrange, Act
        let action = page_key(press(KeyCode::F(5)));

        // Assert
        assert_eq!(action, Some(Action::Event(json!({ "type": "start" }))));
    }

    #[test]
    fn shift_down_selects_the_next_item_as_command_down_does() {
        // Arrange, Act
        let action = page_key(with(KeyCode::Down, KeyModifiers::SHIFT));

        // Assert
        assert_eq!(action, Some(Action::Event(json!({ "type": "item", "delta": 1 }))));
    }

    #[test]
    fn option_up_moves_the_item() {
        // Arrange, Act
        let action = page_key(with(KeyCode::Up, KeyModifiers::ALT));

        // Assert
        assert_eq!(action, Some(Action::Event(json!({ "type": "move", "delta": -1 }))));
    }

    #[test]
    fn a_digit_is_sent_as_a_number() {
        // Arrange, Act
        let action = page_key(press(KeyCode::Char('3')));

        // Assert
        assert_eq!(action, Some(Action::Event(json!({ "type": "digit", "digit": 3 }))));
    }

    #[test]
    fn right_in_the_output_view_steps_forward() {
        // Arrange, Act
        let actions = [output_key(press(KeyCode::Right)), output_key(press(KeyCode::Char(' '))), output_key(press(KeyCode::Enter))];

        // Assert
        for a in actions { assert_eq!(a, Some(Action::Event(json!({ "type": "step", "delta": 1 })))) }
    }

    #[test]
    fn left_in_the_output_view_steps_back() {
        // Arrange, Act
        let action = output_key(press(KeyCode::Left));

        // Assert
        assert_eq!(action, Some(Action::Event(json!({ "type": "step", "delta": -1 }))));
    }

    #[test]
    fn escape_in_the_output_view_goes_back_to_the_page() {
        // Arrange, Act
        let action = output_key(press(KeyCode::Esc));

        // Assert
        assert_eq!(action, Some(Action::Output));
    }

    #[test]
    fn control_c_quits_everywhere() {
        // Arrange
        let key = with(KeyCode::Char('c'), KeyModifiers::CONTROL);

        // Act
        let actions = [start_key(key), page_key(key), output_key(key), confirm_key(key)];

        // Assert
        for a in actions { assert_eq!(a, Some(Action::Quit)) }
    }

    #[test]
    fn a_click_on_a_row_opens_it() {
        // Arrange, Act
        let action = click(&Target::Row(3));

        // Assert
        assert_eq!(action, Some(Action::OpenRow(3)));
    }

    #[test]
    fn a_click_on_an_item_selects_it() {
        // Arrange, Act
        let action = click(&Target::Item("i2".into()));

        // Assert
        assert_eq!(action, Some(Action::Event(json!({ "type": "select", "itemId": "i2" }))));
    }

    #[test]
    fn a_click_on_a_slide_is_a_tap_on_it() {
        // Arrange, Act
        let action = click(&Target::Slide(SlideAt { item_id: "i1".into(), part_index: 2 }));

        // Assert
        assert_eq!(action, Some(Action::Event(json!({ "type": "show", "itemId": "i1", "partIndex": 2 }))));
    }

    #[test]
    fn an_unknown_key_does_nothing() {
        // Arrange, Act
        let action = page_key(press(KeyCode::Char('z')));

        // Assert
        assert_eq!(action, None);
    }
}
