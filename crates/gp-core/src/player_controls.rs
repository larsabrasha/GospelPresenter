// A played file's controls and its Tona ut, as every shell shows and does them (spec 04 §1b; the web's PlayerControls
// and AudioPlayer, apps/web/src/live/audio.ts): play or pause by what it does, the position's time as m:ss of the
// whole, and an audio file's Tona ut, offered while it plays and is not fading; Tona ut takes the volume down over
// 5 s, easing out (a cubic), then the file is paused, back at its start, at its volume again.
use crate::args::*;
use crate::view_types::{FadeStep, PlayerControls, PlayerFade};
use serde_json::Value;

/// Tona ut's length, and how often a shell sets the volume while it runs.
const FADE_MS: i64 = 5000;
const FADE_TICK_MS: i64 = 50;

/// m:ss, as the web's player shows a time; a time not known yet is 0:00.
fn clock(seconds: f64) -> String {
    let n = if seconds.is_finite() { seconds.max(0.0) as i64 } else { 0 };
    format!("{}:{:02}", n / 60, n % 60)
}

/// `playerControlsView` {kind, playing, position, duration, fading}: the controls of a `video` or `audio` file
/// (`PlayerControls`): the toggle's icon and label, the slider's label and its end, the time, and Tona ut for audio.
pub fn controls(a: &Obj) -> R<Value> {
    let kind = a.get("kind").and_then(Value::as_str).filter(|k| *k == "video" || *k == "audio").ok_or("invalid-args")?;
    let number = |k: &str| a.get(k).and_then(Value::as_f64).filter(|n| n.is_finite()).unwrap_or(0.0);
    let flag = |k: &str| a.get(k).and_then(Value::as_bool).unwrap_or(false);
    let (playing, position, duration) = (flag("playing"), number("position"), number("duration"));
    let out = PlayerControls {
        icon: if playing { "pause" } else { "play" }.into(),
        toggle: format!("{kind}.{}", if playing { "pause" } else { "play" }),
        seek: format!("{kind}.seek"),
        end: duration.max(0.1),
        time: format!("{} / {}", clock(position), clock(duration)),
        fade: (kind == "audio").then(|| PlayerFade { text: "audio.fade".into(), enabled: playing && !flag("fading") }),
    };
    serde_json::to_value(out).map_err(|e| e.to_string())
}

/// `fadeOutView` {from, elapsedMs}: Tona ut `elapsedMs` after it began from the volume `from` (`FadeStep`): the volume
/// now, when to ask again, and whether it is done (then pause, back to the start, the volume `from` again).
pub fn fade(a: &Obj) -> R<Value> {
    let from = a.get("from").and_then(Value::as_f64).ok_or("invalid-args")?;
    let elapsed = a.get("elapsedMs").and_then(Value::as_i64).ok_or("invalid-args")?;
    let t = (elapsed as f64 / FADE_MS as f64).clamp(0.0, 1.0);
    let done = t >= 1.0;
    let out = FadeStep { volume: if done { 0.0 } else { from * (1.0 - t).powi(3) }, done, next_ms: FADE_TICK_MS };
    serde_json::to_value(out).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn controls_of(args: Value) -> PlayerControls { serde_json::from_value(controls(args.as_object().unwrap()).unwrap()).unwrap() }
    fn fade_at(from: f64, ms: i64) -> FadeStep { serde_json::from_value(fade(json!({ "from": from, "elapsedMs": ms }).as_object().unwrap()).unwrap()).unwrap() }

    #[test]
    fn a_playing_file_offers_pause() {
        let out = controls_of(json!({ "kind": "video", "playing": true }));

        assert_eq!((out.icon.as_str(), out.toggle.as_str()), ("pause", "video.pause"));
    }

    #[test]
    fn a_paused_file_offers_play() {
        let out = controls_of(json!({ "kind": "audio", "playing": false }));

        assert_eq!((out.icon.as_str(), out.toggle.as_str()), ("play", "audio.play"));
    }

    #[test]
    fn the_time_is_minutes_and_seconds_of_the_whole() {
        let out = controls_of(json!({ "kind": "video", "position": 72.9, "duration": 605.0 }));

        assert_eq!(out.time, "1:12 / 10:05");
    }

    #[test]
    fn a_duration_not_known_yet_reads_as_none() {
        let out = controls_of(json!({ "kind": "video", "position": 3.0, "duration": null }));

        assert_eq!((out.time.as_str(), out.end), ("0:03 / 0:00", 0.1));
    }

    #[test]
    fn only_audio_has_tona_ut() {
        let video = controls_of(json!({ "kind": "video", "playing": true }));
        let audio = controls_of(json!({ "kind": "audio", "playing": true }));

        assert_eq!((video.fade, audio.fade.map(|f| f.enabled)), (None, Some(true)));
    }

    #[test]
    fn tona_ut_is_not_offered_while_paused_or_fading() {
        let paused = controls_of(json!({ "kind": "audio", "playing": false }));
        let fading = controls_of(json!({ "kind": "audio", "playing": true, "fading": true }));

        assert_eq!((paused.fade.map(|f| f.enabled), fading.fade.map(|f| f.enabled)), (Some(false), Some(false)));
    }

    #[test]
    fn the_fade_eases_out_as_a_cubic() {
        let half = fade_at(0.8, 2500);

        assert!((half.volume - 0.8 * 0.125).abs() < 1e-9 && !half.done);
    }

    #[test]
    fn the_fade_is_done_after_five_seconds() {
        let out = fade_at(1.0, 5000);

        assert_eq!((out.volume, out.done), (0.0, true));
    }

    #[test]
    fn the_fade_is_asked_again_every_fifty_ms() {
        let out = fade_at(1.0, 0);

        assert_eq!((out.volume, out.next_ms), (1.0, 50));
    }
}
