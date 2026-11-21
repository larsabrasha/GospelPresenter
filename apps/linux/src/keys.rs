// A GTK key as the terminal shell's key, so which key is which event is written once (crates/gp-tui/src/keys.rs): the
// page's keys are the Mac app's, ⇧↑ ⇧↓ in ⌘↑ ⌘↓'s place, as there. Keys the terminal has and a window does not want
// (q quits a terminal; a window closes with Ctrl+Q) are left out here.
use gtk::gdk::{Key, ModifierType};
use ratatui::crossterm::event::{KeyCode, KeyEvent, KeyModifiers};

/// The key as crossterm names it; None for one the page has no use for.
pub fn key_event(key: Key, state: ModifierType) -> Option<KeyEvent> {
    let code = match key {
        Key::Left => KeyCode::Left,
        Key::Right => KeyCode::Right,
        Key::Up => KeyCode::Up,
        Key::Down => KeyCode::Down,
        Key::Page_Up => KeyCode::PageUp,
        Key::Page_Down => KeyCode::PageDown,
        Key::Return | Key::KP_Enter => KeyCode::Enter,
        Key::Escape => KeyCode::Esc,
        Key::Tab => KeyCode::Tab,
        Key::BackSpace => KeyCode::Backspace,
        Key::F5 => KeyCode::F(5),
        Key::space => KeyCode::Char(' '),
        k => match k.to_unicode() {
            Some('q') | None => return None,
            Some(c) => KeyCode::Char(c),
        },
    };
    let mut m = KeyModifiers::NONE;
    if state.contains(ModifierType::SHIFT_MASK) { m |= KeyModifiers::SHIFT }
    if state.contains(ModifierType::ALT_MASK) { m |= KeyModifiers::ALT }
    if state.contains(ModifierType::CONTROL_MASK) { m |= KeyModifiers::CONTROL }
    Some(KeyEvent::new(code, m))
}

#[cfg(test)]
mod tests {
    use super::*;
    use gp_tui::keys::{page_key, Action};
    use serde_json::json;

    #[test]
    fn right_makes_the_next_slide_ready_as_in_the_terminal() {
        // Arrange
        let key = key_event(Key::Right, ModifierType::empty()).unwrap();

        // Act
        let action = page_key(key);

        // Assert
        assert_eq!(action, Some(Action::Event(json!({ "type": "pick", "delta": 1 }))));
    }

    #[test]
    fn shift_down_goes_to_the_next_item() {
        // Arrange
        let key = key_event(Key::Down, ModifierType::SHIFT_MASK).unwrap();

        // Act
        let action = page_key(key);

        // Assert
        assert_eq!(action, Some(Action::Event(json!({ "type": "item", "delta": 1 }))));
    }

    #[test]
    fn q_is_not_the_pages() {
        // Arrange, Act
        let key = key_event(Key::q, ModifierType::empty());

        // Assert
        assert!(key.is_none());
    }
}
