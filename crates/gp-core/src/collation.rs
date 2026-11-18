// Names ordered as the page's language orders them, as the web's Intl.Collator did (`sensitivity: 'base'` for names,
// the default for ids): ICU4X's collator over the data of collation_data, Swedish and English only, written by
// crates/gp-core-collation. One order for every shell: the web, the native apps, and what comes.
use icu_collator::options::{CollatorOptions, Strength};
use icu_collator::{Collator, CollatorBorrowed};
use std::cmp::Ordering;

#[allow(dead_code)] // the generated data names every locale's payload, some only through another
mod baked {
    pub struct Baked;
    include!("collation_data/mod.rs");
    impl_data_provider!(Baked);
}
use baked::Baked;

/// The page's language: Swedish, or English for anything else (`i18n.ts`'s two).
#[derive(Clone, Copy)]
pub enum Lang { Sv, En }

impl Lang {
    pub fn of(code: Option<&str>) -> Lang { if code.is_some_and(|c| c.starts_with("en")) { Lang::En } else { Lang::Sv } }
}

thread_local! {
    /// Made once each (a collator is a few kB of tables): base and tertiary, Swedish and English.
    static COLLATORS: [Collator; 4] = [(Lang::Sv, true), (Lang::Sv, false), (Lang::En, true), (Lang::En, false)].map(|(l, base)| {
        let mut o = CollatorOptions::default();
        o.strength = Some(if base { Strength::Primary } else { Strength::Tertiary });
        let locale = match l { Lang::Sv => icu_locale_core::locale!("sv"), Lang::En => icu_locale_core::locale!("en") };
        Collator::try_new_unstable(&Baked, locale.into(), o).expect("the collation data is built in")
    });
}

fn with<T>(lang: Lang, base: bool, f: impl FnOnce(CollatorBorrowed<'_>) -> T) -> T {
    let i = match lang { Lang::Sv => 0, Lang::En => 2 } + usize::from(!base);
    COLLATORS.with(|c| f(c[i].as_borrowed()))
}

/// Names compared as the language orders them, case and accents aside (`sensitivity: 'base'`).
pub fn names(lang: Lang, a: &str, b: &str) -> Ordering { with(lang, true, |c| c.compare(a, b)) }

/// Ids compared as `localeCompare` without options does: case and accents too.
pub fn ids(lang: Lang, a: &str, b: &str) -> Ordering { with(lang, false, |c| c.compare(a, b)) }

/// A key a view's rows are ordered by, a field of each row's JSON, then the next where they tie.
pub enum Key<'a> {
    /// A name, as the language orders it, case and accents aside.
    Name(&'a str),
    /// An id or a date, case and accents too; `Desc` the other way.
    Id(&'a str),
    Desc(&'a str),
    /// A number, missing ones as -1; the smallest first, or the largest.
    Asc(&'a str),
    Last(&'a str),
}

/// A field as String() has it: a string itself, a number written, else "null".
fn text(v: &serde_json::Value, k: &str) -> String {
    match &v[k] { serde_json::Value::String(s) => s.clone(), serde_json::Value::Number(n) => n.to_string(), _ => "null".into() }
}
fn number(v: &serde_json::Value, k: &str) -> f64 { v[k].as_f64().unwrap_or(-1.0) }

/// `rows` ordered by `keys`, ties kept in the order they came (a stable sort, as `toSorted`).
pub fn sort(lang: Lang, rows: &mut [serde_json::Value], keys: &[Key]) {
    rows.sort_by(|a, b| {
        keys.iter().map(|key| match key {
            Key::Name(k) => names(lang, &text(a, k), &text(b, k)),
            Key::Id(k) => ids(lang, &text(a, k), &text(b, k)),
            Key::Desc(k) => ids(lang, &text(b, k), &text(a, k)),
            Key::Asc(k) => number(a, k).total_cmp(&number(b, k)),
            Key::Last(k) => number(b, k).total_cmp(&number(a, k)),
        }).find(|o| o.is_ne()).unwrap_or(Ordering::Equal)
    });
}

/// The page's language a view is asked in (`locale`, i18n.ts's), Swedish when none is given.
pub fn lang(a: &crate::args::Obj) -> Lang { Lang::of(a.get("locale").and_then(serde_json::Value::as_str)) }
