// The media files this device keeps (docs/media-and-files.md, "Which files a device keeps"), as the Mac app's
// MediaSync.swift: what to fetch and what to drop is the core's (`mediaPlanView`, over the files in the folder); this
// lists the folder, removes what the core drops and fetches the rest from the host as the signed-in device, ten at a
// time, the window drawn again after each ten so what is on screen fills in while the rest comes. Run when the sync
// says the files changed (its `media` effect) and when presenting starts or moves to another presentation; once at a
// time, again if asked meanwhile.
use crate::painter::media_dir;
use crate::shell::Shell;
use serde::Deserialize;
use serde_json::json;
use std::cell::{Cell, RefCell};
use std::rc::Rc;

/// The most bytes kept of files nothing wants now: MEDIA-R14's 2 GiB, as on the web (no Lagring page here yet).
const BUDGET: i64 = 2 * 1024 * 1024 * 1024;
/// Files fetched before the window is drawn again.
const BATCH: usize = 10;

thread_local! {
    static RUNNING: Cell<bool> = const { Cell::new(false) };
    static AGAIN: Cell<bool> = const { Cell::new(false) };
    /// The presentation presented when the files were last planned: another one plans again.
    static PRESENTING: RefCell<Option<String>> = const { RefCell::new(None) };
}

#[derive(Deserialize)]
struct Plan { fetch: Vec<String>, drop: Vec<String> }

/// A file in the folder, named by its hash: its hash, its bytes and when it came (ms), as `held` is read; a part left
/// by a cut download removed.
fn held() -> Vec<serde_json::Value> {
    let Ok(entries) = std::fs::read_dir(media_dir()) else { return vec![] };
    entries.filter_map(Result::ok).filter_map(|e| {
        let name = e.file_name().into_string().ok()?;
        // A download cut off (the app closed meanwhile): no fetch runs while the folder is listed.
        if name.ends_with(".part") { let _ = std::fs::remove_file(e.path()); return None }
        if name.len() != 64 || !name.bytes().all(|b| b.is_ascii_hexdigit()) { return None }
        let meta = e.metadata().ok()?;
        let at = meta.modified().ok()?.duration_since(std::time::UNIX_EPOCH).ok()?.as_millis() as i64;
        Some(json!({ "hash": name, "size": meta.len(), "at": at }))
    }).collect()
}

/// Presenting started, ended or moved to another presentation: its files planned at once.
pub fn follow(shell: &Rc<Shell>) {
    let now = shell.model.borrow().app.live.presentation_id.clone();
    if PRESENTING.with(|p| p.replace(now.clone())) != now { sync(shell) }
}

/// The files planned and fetched, while signed in to a host.
pub fn sync(shell: &Rc<Shell>) {
    if shell.sync.borrow().is_none() { return }
    if RUNNING.get() { return AGAIN.set(true) }
    RUNNING.set(true);
    AGAIN.set(false);
    // Listed off the main thread: a church's folder holds thousands of files.
    crate::sync::in_background(held, |shell, held| {
        let (presenting, today) = { let m = shell.model.borrow(); (m.app.live.presentation_id.clone(), m.app.today.clone()) };
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis() as i64);
        let policy = json!({
            "presenting": presenting, "persistent": true, "keepComing": false, "today": today, "days": 7,
            "budget": BUDGET, "now": now, "held": held, "inUse": [],
        });
        let plan = shell.model.borrow().app.core().call("mediaPlanView", policy).ok().and_then(|v| serde_json::from_value::<Plan>(v).ok());
        let Some(plan) = plan else { return done(shell) };
        for hash in &plan.drop { let _ = std::fs::remove_file(media_dir().join(hash)); }
        let _ = std::fs::create_dir_all(media_dir());
        fetch(shell, plan.fetch);
    });
}

/// The next ten fetched on a thread, the window drawn again, then the rest.
fn fetch(shell: &Rc<Shell>, mut wanted: Vec<String>) {
    let Some((server, session)) = shell.sync.borrow().as_ref().map(|s| s.server_and_session()) else { return done(shell) };
    if wanted.is_empty() { return done(shell) }
    let rest = wanted.split_off(wanted.len().min(BATCH));
    crate::sync::in_background(move || {
        wanted.iter().filter(|hash| server.download(&format!("/api/media/{hash}"), &session, &media_dir().join(hash), hash)).count()
    }, move |shell, arrived| {
        if arrived > 0 { shell.refresh() }
        fetch(shell, rest);
    });
}

/// This run ended: another if one was asked for meanwhile.
fn done(shell: &Rc<Shell>) {
    RUNNING.set(false);
    if AGAIN.get() { sync(shell) }
}
