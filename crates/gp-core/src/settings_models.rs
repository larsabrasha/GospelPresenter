// Inställningar as every shell draws it (docs/view-models.md, docs/layout-2-0.md): its list of pages in groups, who
// sees which, what each page is for, the words a search finds it by; and Mina inställningar's groups. The web had
// these in apps/web/src/pages/settings/settingsLinks.ts and Settings.tsx; the Mac and iOS app draws the same from
// here. Each row's `id` is the page it opens, by the web's name for it; how a shell gets there (a route, a navigation
// stack, a split view's detail) stays the shell's, and so do the words: only i18n.ts's keys are given.
use crate::args::*;
use crate::mutators::can;
use serde_json::{json, Value};

/// A row's icon square, as iOS's Settings colours its rows: its Tailwind name (the web's class is `bg-` and it) and
/// its hex, the same light and dark.
fn colour(name: &str) -> Value {
    let hex = match name {
        "blue-500" => "#3b82f6",
        "amber-700" => "#b45309",
        "rose-500" => "#f43f5e",
        "orange-500" => "#f97316",
        "purple-500" => "#a855f7",
        "orange-700" => "#c2410c",
        "indigo-500" => "#6366f1",
        "green-500" => "#22c55e",
        "sky-500" => "#0ea5e9",
        "sky-600" => "#0284c7",
        "cyan-500" => "#06b6d4",
        "teal-500" => "#14b8a6",
        "indigo-600" => "#4f46e5",
        "red-500" => "#ef4444",
        _ => "#78716c", // stone-500
    };
    json!({ "name": name, "hex": hex })
}

/// A row: the page it opens, its name's key, its icon (a name of the app's own, as `page_models.rs`' actions have
/// them), its square's colour, the key of the other words a search finds it by, the key of what the page is for
/// (shown as a card at its top where it is not plain, as iOS's Settings has it), and where a search result lives
/// when it is not a row of the list (Mina inställningar's).
struct Row { id: &'static str, text: &'static str, icon: &'static str, colour: &'static str, keywords: &'static str, intro: Option<&'static str>, mine: bool }

impl Row {
    fn json(&self) -> Value {
        json!({ "id": self.id, "text": self.text, "icon": self.icon, "colour": colour(self.colour), "keywords": self.keywords,
                "intro": self.intro, "where": if self.mine { json!("nav.settings") } else { Value::Null } })
    }
}

const fn row(id: &'static str, text: &'static str, icon: &'static str, colour: &'static str, keywords: &'static str, intro: Option<&'static str>) -> Row {
    Row { id, text, icon, colour, keywords, intro, mine: false }
}

/// The permission a row needs, none for everyone's; Enheter is the desktop host's only (a cloud has no paired devices).
fn needs(id: &str) -> Option<&'static str> {
    Some(match id {
        "bibles" => "ManageBibles",
        "images" => "ViewImages",
        "audios" => "ViewAudios",
        "videos" => "ViewVideos",
        "customSlides" => "ManagePresentations",
        "overlays" => "ManageOverlays",
        "labels" => "ManageSongs",
        "displays" => "ManageRemoteDisplays",
        "ccliReport" => "ViewCcliReport",
        "users" => "ViewUsers",
        "devices" => "ManageUsers",
        "orgSettings" => "ManageOrganizationSettings",
        // The Superadmin's pages, across organisations (spec 01 sidebar); Felrapporter from every organisation on
        // this server (docs/bug-reports.md).
        "orgs" | "reports" => "ManageOrganizations",
        _ => return None,
    })
}

/// The list's groups in order, each its title's key (none for Papperskorg and Om Gospel Presenter, apart at the foot)
/// and its rows. Mallar is in none: a page of its own, reached from Skapa presentation.
const GROUPS: &[(&str, Option<&str>, &[Row])] = &[
    ("library", Some("settings.group.library"), &[
        row("songs", "nav.songs", "song", "blue-500", "search.songs", None),
        row("bibles", "nav.bibles", "bible", "amber-700", "search.bibles", None),
        row("images", "nav.images", "image", "rose-500", "search.images", None),
        row("audios", "nav.audios", "audio", "orange-500", "search.audios", None),
        row("videos", "nav.videos", "video", "purple-500", "search.videos", None),
        row("customSlides", "nav.customSlides", "slides", "orange-700", "search.customSlides", None),
    ]),
    ("presentation", Some("settings.group.presentation"), &[
        row("overlays", "overlays.title", "overlay", "indigo-500", "search.overlays", Some("intro.overlays")),
        row("labels", "nav.labels", "label", "green-500", "search.labels", Some("intro.labels")),
    ]),
    ("display", Some("settings.group.display"), &[
        row("displays", "nav.displays", "display", "sky-500", "search.displays", Some("intro.displays")),
        row("themes", "nav.themes", "theme", "stone-500", "search.themes", Some("themes.text")),
        row("ccliReport", "nav.ccliReport", "ccli", "cyan-500", "search.ccliReport", Some("intro.ccliReport")),
    ]),
    ("church", Some("settings.group.church"), &[
        row("users", "nav.users", "users", "blue-500", "search.users", None),
        row("devices", "nav.devices", "devices", "teal-500", "search.devices", Some("intro.devices")),
        row("orgSettings", "nav.orgSettings", "settings", "stone-500", "search.orgSettings", Some("intro.orgSettings")),
        row("orgs", "nav.orgs", "orgs", "indigo-600", "search.orgs", None),
        row("reports", "nav.reports", "bug", "red-500", "search.reports", None),
    ]),
    // The one trash for everything deleted (Lars, 2026-11-02), rather than one beside every list.
    ("trash", None, &[row("trash", "nav.trash", "trash", "stone-500", "search.trash", None)]),
    ("about", None, &[row("about", "nav.about", "about", "stone-500", "search.about", None)]),
];

/// What Mina inställningar holds, for the search only: its choices and its pages, each found by its own name (Lars,
/// 2026-11-03); a choice opens Mina inställningar itself (`id` "settings").
const MINE: &[Row] = &[
    Row { id: "settings", text: "settings.theme", icon: "appearance", colour: "blue-500", keywords: "search.theme", intro: None, mine: true },
    Row { id: "settings", text: "settings.language", icon: "language", colour: "sky-600", keywords: "search.language", intro: None, mine: true },
    Row { id: "storage", text: "storage.title", icon: "storage", colour: "stone-500", keywords: "search.storage", intro: None, mine: true },
    Row { id: "logins", text: "logins.title", icon: "user", colour: "stone-500", keywords: "search.logins", intro: None, mine: true },
    Row { id: "myReports", text: "myReports.title", icon: "bug", colour: "red-500", keywords: "search.myReports", intro: None, mine: true },
];

/// Whether `role` (on a desktop host or not) may open the row: as the pages refuse the others, the list leaves them out.
fn shown(r: &Row, role: &str, host: bool) -> bool {
    (r.id != "devices" || host) && needs(r.id).is_none_or(|p| can(role, p))
}

fn flags(a: &Obj) -> R<(&str, bool)> {
    let role = a.get("role").and_then(Value::as_str).ok_or("invalid-args")?;
    Ok((role, a.get("host").and_then(Value::as_bool).unwrap_or(false)))
}

/// `settingsListView` {role, host}: the list's groups in order, each its `id`, its `title`'s key (null for the two at
/// the foot) and its `rows`; a row the user may not open is left out, and so is a group left empty. `host`: the app runs
/// on (or is paired with) a church's desktop host, where Enheter is.
pub fn list(a: &Obj) -> R<Value> {
    let (role, host) = flags(a)?;
    Ok(Value::Array(GROUPS.iter().filter_map(|(id, title, rows)| {
        let rows: Vec<Value> = rows.iter().filter(|r| shown(r, role, host)).map(Row::json).collect();
        (!rows.is_empty()).then(|| json!({ "id": id, "title": title, "rows": rows }))
    }).collect()))
}

/// Lower case, accents kept (å, ä and ö are letters of their own in Swedish), as the web's `fold`.
fn fold(s: &str) -> String { s.trim().to_lowercase() }

/// `settingsSearchView` {role, host, query, texts}: the rows `query` finds, in the list's order and then Mina
/// inställningar's: a row whose name or one of whose words holds every word of the query. `texts` gives each key's
/// words in the page's language ({key: words}, the shell's i18n), as the core holds no words; a key it lacks counts as
/// no words. Empty for an empty query.
pub fn search(a: &Obj) -> R<Value> {
    let (role, host) = flags(a)?;
    let query = fold(a.get("query").and_then(Value::as_str).unwrap_or(""));
    let words: Vec<&str> = query.split_whitespace().collect();
    if words.is_empty() { return Ok(json!([])) }
    let texts = a.get("texts").and_then(Value::as_object);
    let said = |k: &str| texts.and_then(|t| t.get(k)).and_then(Value::as_str).unwrap_or("");
    let rows = GROUPS.iter().flat_map(|(_, _, rows)| rows.iter()).filter(|r| shown(r, role, host)).chain(MINE.iter());
    Ok(Value::Array(rows.filter(|r| {
        let all = fold(&format!("{},{}", said(r.text), said(r.keywords)));
        words.iter().all(|w| all.contains(w))
    }).map(Row::json).collect()))
}

/// The keys `settingsSearchView` reads words for: every row's name and other words, so a shell gives just those.
pub fn search_keys() -> Value {
    let rows = GROUPS.iter().flat_map(|(_, _, rows)| rows.iter()).chain(MINE.iter());
    let mut keys: Vec<&str> = rows.flat_map(|r| [r.text, r.keywords]).collect();
    keys.dedup();
    json!(keys)
}

/// `mySettingsView` {role, superAdmin, desktop, email, emailConfirmed, mail}: Mina inställningar's groups in order
/// (Settings.tsx, settings/Profile.tsx), each its `id`, its title's and footer's keys and its `rows`, each a row's
/// `id`, its `kind` (`field`, `value`, `action`, `choice`, `switch`, `link`), its text's key and, by kind, its
/// choices. The name and address are the person's own, changed by them; Bekräfta e-post only for an address not yet
/// confirmed where the server can mail; Superadminläge only for a Superadmin, on while their role is superAdmin; Slå
/// på utgångar automatiskt only in the desktop app, where an output goes to a display (`desktop`). The colour theme
/// and the language are this device's own. The version is under Om Gospel Presenter.
pub fn mine(a: &Obj) -> R<Value> {
    let flag = |k: &str| a.get(k).and_then(Value::as_bool).unwrap_or(false);
    let role = a.get("role").and_then(Value::as_str).ok_or("invalid-args")?;
    let email = a.get("email").and_then(Value::as_str).filter(|e| !e.is_empty());
    let r = |id: &str, kind: &str, text: &str| json!({ "id": id, "kind": kind, "text": text });
    let mut profile = vec![
        r("name", "field", "users.name"),
        json!({ "id": "email", "kind": "value", "text": "users.email", "value": email, "empty": "profile.noEmail",
                "badge": email.map(|_| if flag("emailConfirmed") { json!({ "text": "profile.confirmed", "colour": "green" }) } else { json!({ "text": "profile.unconfirmed", "colour": "amber" }) }) }),
    ];
    if email.is_some() && !flag("emailConfirmed") && flag("mail") { profile.push(r("confirmEmail", "action", "profile.confirm")) }
    profile.push(r("changeEmail", "action", "profile.changeEmail"));
    let choices = |list: &[(&str, &str)]| Value::Array(list.iter().map(|(id, text)| json!({ "id": id, "text": text })).collect());
    let mut theme = r("theme", "choice", "settings.theme");
    theme["choices"] = choices(&[("system", "settings.themeSystem"), ("light", "settings.themeLight"), ("dark", "settings.themeDark")]);
    let mut language = r("language", "choice", "settings.language");
    language["choices"] = choices(&[("sv", "settings.languageSv"), ("en", "settings.languageEn")]);
    let mut device = vec![r("storage", "link", "storage.title")];
    if flag("desktop") {
        let mut auto = r("autoOutputs", "switch", "settings.autoOutputs");
        auto["description"] = json!("settings.autoOutputsDescription");
        device.push(auto);
    }
    let group = |id: &str, title: Option<&str>, footer: Option<&str>, rows: Vec<Value>| json!({ "id": id, "title": title, "footer": footer, "rows": rows });
    let mut groups = vec![group("profile", Some("profile.title"), None, profile)];
    if flag("superAdmin") {
        let mut on = r("superMode", "switch", "superMode.title");
        on["on"] = json!(role == "superAdmin");
        groups.push(group("superMode", None, Some("superMode.description"), vec![on]));
    }
    groups.extend([
        group("theme", Some("settings.theme"), None, vec![theme]),
        group("language", None, Some("settings.themeDescription"), vec![language]),
        group("thisDevice", Some("settings.thisDevice"), None, device),
        group("account", Some("settings.account"), None, vec![r("logins", "link", "logins.title"), r("myReports", "link", "myReports.title")]),
    ]);
    Ok(json!({ "groups": groups }))
}

/// `userRulesView` {actor: {id, role}, users: [{id, role, superAdmin?, onlyHere?}], host?}: what Användare and Enheter
/// offer for each member before anything is pressed (the web's UserDetail.tsx and Devices.tsx over packages/core's
/// accounts.ts): `self`; `canEdit` (name and address, only in superadminläge); `roles` the role menu offers and
/// `roleLocked` (your own, or without ManageUsers; `roleChangeRefusal`); `canAccount` (logins and invite links: yours,
/// or someone's whose account you may change, `accountRefusal`, `host` a desktop host); `canRemove`
/// (`removeUserRefusal`); `pairAs` (Anslut enhet may sign a device in as them). As on the web, the count of Admins is
/// not known here: the server refuses the last one's demotion or removal itself.
pub fn user_rules(a: &Obj) -> R<Value> {
    let actor = a.get("actor").and_then(Value::as_object).ok_or("invalid-args")?;
    let (me, role) = (actor.get("id").and_then(Value::as_str).unwrap_or(""), actor.get("role").and_then(Value::as_str).unwrap_or(""));
    let host = a.get("host").and_then(Value::as_bool).unwrap_or(false);
    let manage = crate::mutators::can(role, "ManageUsers");
    // accountRefusal: a Superadmin may; an Admin only someone whose one membership is the host's, not a Superadmin.
    let account = |host_only: bool, super_admin: bool| role == "superAdmin" || (manage && host_only && !super_admin);
    let users = a.get("users").and_then(Value::as_array).ok_or("invalid-args")?;
    let rules: Vec<Value> = users.iter().map(|u| {
        let id = u.get("id").and_then(Value::as_str).unwrap_or("");
        let target = u.get("role").and_then(Value::as_str).unwrap_or("user");
        let flag = |k: &str| u.get(k).and_then(Value::as_bool).unwrap_or(false);
        let own = id == me;
        // roleChangeRefusal with two Admins assumed, as the web asks it: forbidden and own-role only.
        let roles: Vec<&str> = ["user", "admin"].into_iter().filter(|r| *r == target || (manage && !own)).collect();
        // removeUserRefusal, likewise: forbidden, own-account and super-admin-only.
        let can_remove = manage && !own && !(flag("superAdmin") && role != "superAdmin");
        json!({ "id": id, "self": own, "canEdit": role == "superAdmin", "roles": roles, "roleLocked": own || !manage,
                "canAccount": own || account(host && flag("onlyHere"), flag("superAdmin")), "canRemove": can_remove,
                "pairAs": own || account(flag("onlyHere"), flag("superAdmin")) })
    }).collect();
    Ok(json!({ "users": rules }))
}

/// `autoOutputsView` {before?: [{id, name}], now: [{id, name}], last: {name: on}, open: [id]}: Slå på utgångar
/// automatiskt while a presentation runs (the web's live/autoOutputs.ts `displaysToTurnOn` and useAutoOutputs.ts): `on`
/// the displays to switch on, every one new since `before` (all of `now` at the start, `before` absent) but those last
/// switched off by hand (`last` false); `off` those gone since `before` whose output is open.
pub fn auto_outputs(a: &Obj) -> R<Value> {
    let ids = |v: Option<&Value>| -> Vec<(String, String)> {
        v.and_then(Value::as_array).map_or(vec![], |l| l.iter().map(|d| (js_str(d.get("id")), js_str(d.get("name")))).collect())
    };
    let now = ids(a.get("now"));
    let before = a.get("before").filter(|v| !v.is_null()).map(|v| ids(Some(v)));
    let last = a.get("last").and_then(Value::as_object);
    let open: Vec<String> = a.get("open").and_then(Value::as_array).map_or(vec![], |l| l.iter().map(|v| js_str(Some(v))).collect());
    let on: Vec<&String> = now.iter()
        .filter(|(id, _)| before.as_ref().is_none_or(|b| !b.iter().any(|(k, _)| k == id)))
        .filter(|(_, name)| last.and_then(|l| l.get(name)) != Some(&Value::Bool(false)))
        .map(|(id, _)| id).collect();
    let off: Vec<&String> = before.iter().flatten()
        .filter(|(id, _)| !now.iter().any(|(n, _)| n == id) && open.contains(id))
        .map(|(id, _)| id).collect();
    Ok(json!({ "on": on, "off": off }))
}

fn js_str(v: Option<&Value>) -> String { v.and_then(Value::as_str).unwrap_or("").to_string() }

#[cfg(test)]
#[path = "settings_models_tests.rs"]
mod tests;
