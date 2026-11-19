// What the device presenting does with an item's audio or video when the live state changes (spec 04 §1b, LIVE-R6;
// docs/live.md "Where audio and video play"; the web's Player and its engines, apps/web/src/live/player.ts): a video
// or audio item shown plays from its start, anything else shown stops it, Släck pauses it and a slide shown again
// plays it on where it was, unless it was paused by hand. The shell says what its player holds and does, the core
// what it does next; the shell does it, fetching the file the core names (`livePlaybackView`).
use crate::args::*;
use serde_json::{json, Value};

/// What a shell's player holds: the item it has loaded, whether the outputs were black when it last heard, whether
/// it plays, and whether it was playing when Släck paused it.
#[derive(Debug, Clone, PartialEq)]
struct Player { item_id: Option<String>, black: bool, playing: bool, play_on_show: bool }

/// One step for the shell, in order.
#[derive(Debug, Clone, PartialEq)]
enum Do { Stop, Load { item_id: String, kind: String, play: bool }, Pause, Play }

impl Do {
    fn json(&self) -> Value {
        match self {
            Do::Stop => json!({ "do": "stop" }),
            Do::Load { item_id, kind, play } => json!({ "do": "load", "itemId": item_id, "kind": kind, "play": play }),
            Do::Pause => json!({ "do": "pause" }),
            Do::Play => json!({ "do": "play" }),
        }
    }
}

/// The step: the live state now (`presentation`, the item shown and whether black) and the item's kind, given what the
/// player holds; what it holds after, and what to do.
fn step(p: &Player, presentation: bool, item: Option<(&str, &str)>, black: bool) -> (Player, Vec<Do>) {
    let stopped = |black| Player { item_id: None, black, playing: false, play_on_show: false };
    if !presentation {
        return (stopped(false), if p.item_id.is_some() { vec![Do::Stop] } else { vec![] });
    }
    // The same item shown again (another of its slides, a pull, Släck): it plays on, or is paused by Släck.
    if let Some((id, _)) = item.filter(|(id, _)| p.item_id.as_deref() == Some(*id)) {
        let mut q = Player { item_id: Some(id.to_string()), ..p.clone() };
        return match (p.black, black) {
            (false, true) => {
                q.black = true;
                q.play_on_show = p.playing;
                q.playing = false;
                (q, if p.playing { vec![Do::Pause] } else { vec![] })
            }
            (true, false) => {
                q.black = false;
                q.play_on_show = false;
                q.playing = p.play_on_show;
                (q, if p.play_on_show { vec![Do::Play] } else { vec![] })
            }
            _ => (q, vec![]),
        };
    }
    // Another item: what played stops; a video or audio item's file plays from its start, or waits for the picture
    // when it is made live under Släck.
    let mut steps = if p.item_id.is_some() { vec![Do::Stop] } else { vec![] };
    match item.filter(|(_, kind)| *kind == "video" || *kind == "audio") {
        Some((id, kind)) => {
            steps.push(Do::Load { item_id: id.to_string(), kind: kind.to_string(), play: !black });
            (Player { item_id: Some(id.to_string()), black, playing: !black, play_on_show: black }, steps)
        }
        None => (stopped(black), steps),
    }
}

/// `playbackStepView` {player: {itemId, black, playing, playOnShow}, presentationId, item: {id, type}, black}: what the
/// player holds after the live state now, and the steps to it (`stop`, `load` {itemId, kind, play}, `pause`, `play`).
/// `playing` is the player's own, so a file paused by hand stays paused.
pub fn view(a: &Obj) -> R<Value> {
    let p = a.get("player").and_then(Value::as_object);
    let flag = |k: &str| p.and_then(|p| p.get(k)).and_then(Value::as_bool).unwrap_or(false);
    let player = Player {
        item_id: p.and_then(|p| p.get("itemId")).and_then(Value::as_str).map(str::to_string),
        black: flag("black"),
        playing: flag("playing"),
        play_on_show: flag("playOnShow"),
    };
    let presentation = a.get("presentationId").is_some_and(Value::is_string);
    let item = a.get("item").and_then(Value::as_object).and_then(|i| Some((i.get("id")?.as_str()?, i.get("type").and_then(Value::as_str).unwrap_or(""))));
    let (after, steps) = step(&player, presentation, item, a.get("black").and_then(Value::as_bool).unwrap_or(false));
    Ok(json!({
        "player": { "itemId": after.item_id, "black": after.black, "playing": after.playing, "playOnShow": after.play_on_show },
        "steps": steps.iter().map(Do::json).collect::<Vec<_>>(),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn none() -> Player { Player { item_id: None, black: false, playing: false, play_on_show: false } }
    fn holding(id: &str, playing: bool) -> Player { Player { item_id: Some(id.into()), black: false, playing, play_on_show: false } }
    fn load(id: &str, kind: &str, play: bool) -> Do { Do::Load { item_id: id.into(), kind: kind.into(), play } }

    #[test]
    fn a_video_item_shown_plays_from_its_start() {
        let (after, steps) = step(&none(), true, Some(("v", "video")), false);

        assert_eq!((after, steps), (Player { item_id: Some("v".into()), black: false, playing: true, play_on_show: false }, vec![load("v", "video", true)]));
    }

    #[test]
    fn another_slide_of_the_item_shown_leaves_it_playing() {
        let (_, steps) = step(&holding("v", true), true, Some(("v", "video")), false);

        assert_eq!(steps, vec![]);
    }

    #[test]
    fn another_item_shown_stops_it() {
        let (after, steps) = step(&holding("v", true), true, Some(("s", "song")), false);

        assert_eq!((after.item_id, steps), (None, vec![Do::Stop]));
    }

    #[test]
    fn an_audio_item_after_a_video_stops_the_video_and_plays_the_audio() {
        let (_, steps) = step(&holding("v", true), true, Some(("a", "audio")), false);

        assert_eq!(steps, vec![Do::Stop, load("a", "audio", true)]);
    }

    #[test]
    fn slack_pauses_it_and_the_slide_shown_again_plays_it_on() {
        let (black, paused) = step(&holding("v", true), true, Some(("v", "video")), true);
        let (_, again) = step(&black, true, Some(("v", "video")), false);

        assert_eq!((paused, again), (vec![Do::Pause], vec![Do::Play]));
    }

    #[test]
    fn a_file_paused_by_hand_stays_paused_through_slack() {
        let (black, paused) = step(&holding("v", false), true, Some(("v", "video")), true);
        let (_, again) = step(&black, true, Some(("v", "video")), false);

        assert_eq!((paused, again), (vec![], vec![]));
    }

    #[test]
    fn an_item_made_live_under_slack_waits_for_the_picture() {
        let (black, steps) = step(&none(), true, Some(("v", "video")), true);
        let (_, again) = step(&black, true, Some(("v", "video")), false);

        assert_eq!((steps, again), (vec![load("v", "video", false)], vec![Do::Play]));
    }

    #[test]
    fn presenting_ended_stops_it() {
        let (after, steps) = step(&holding("a", true), false, None, false);

        assert_eq!((after, steps), (none(), vec![Do::Stop]));
    }
}
