// The books of the Bible (packages/core/src/bible-books.ts): USX codes in canonical order, their Swedish and English
// names, the names a reference may use (spec 05 BIBLE-R9–R11, D12); and a reference read as a plan of verses
// (bible.ts's `planVerseSearch`, BIBLE-R11), so every app reads "1 mos 1:2-3" alike.
use crate::args::*;
use serde_json::{json, Value};
use unicode_normalization::UnicodeNormalization;

/// A book: its code, Swedish and English names, and its Swedish names and abbreviations: plain ones, or the stems of a
/// numbered book (`n`), which take every ordinal ("1 mos", "1:a mosebok", "första moseboken").
struct Book { code: &'static str, sv: &'static str, en: &'static str, n: u8, aliases: &'static [&'static str] }

const fn b(code: &'static str, sv: &'static str, en: &'static str, n: u8, aliases: &'static [&'static str]) -> Book { Book { code, sv, en, n, aliases } }

const MOS: &[&str] = &["mos", "mosebok", "moseboken"];
const SAM: &[&str] = &["sam", "samuel", "samuelsboken"];
const KUNG: &[&str] = &["kung", "kungaboken"];
const KRON: &[&str] = &["krön", "krönikeboken"];
const KOR: &[&str] = &["kor", "korintierbrevet"];
const TESS: &[&str] = &["thess", "thessalonikerbrevet", "tess"];
const TIM: &[&str] = &["tim", "timoteusbrevet"];
const PET: &[&str] = &["petr", "petrusbrevet", "pet"];
const JOHB: &[&str] = &["joh", "johannesbrevet"];

/// The 66 books of the Protestant canon, in order; the first 39 are the Old Testament. A numbered book's extra names
/// (Genesis' "genesis", "gen") follow its stems in `EXTRA`.
const BOOKS: [Book; 66] = [
    b("GEN", "1 Moseboken", "Genesis", 1, MOS), b("EXO", "2 Moseboken", "Exodus", 2, MOS), b("LEV", "3 Moseboken", "Leviticus", 3, MOS),
    b("NUM", "4 Moseboken", "Numbers", 4, MOS), b("DEU", "5 Moseboken", "Deuteronomy", 5, MOS),
    b("JOS", "Josua", "Joshua", 0, &["josua", "jos"]), b("JDG", "Domarboken", "Judges", 0, &["domarboken", "dom"]), b("RUT", "Rut", "Ruth", 0, &["rut"]),
    b("1SA", "1 Samuel", "1 Samuel", 1, SAM), b("2SA", "2 Samuel", "2 Samuel", 2, SAM), b("1KI", "1 Kungaboken", "1 Kings", 1, KUNG),
    b("2KI", "2 Kungaboken", "2 Kings", 2, KUNG), b("1CH", "1 Krönikeboken", "1 Chronicles", 1, KRON), b("2CH", "2 Krönikeboken", "2 Chronicles", 2, KRON),
    b("EZR", "Esra", "Ezra", 0, &["esra", "esr"]), b("NEH", "Nehemja", "Nehemiah", 0, &["nehemja", "neh"]), b("EST", "Ester", "Esther", 0, &["ester", "est"]),
    b("JOB", "Job", "Job", 0, &["job"]), b("PSA", "Psaltaren", "Psalms", 0, &["psaltaren", "ps", "psa"]),
    b("PRO", "Ordspråksboken", "Proverbs", 0, &["ordspråksboken", "ords", "ordspr"]), b("ECC", "Predikaren", "Ecclesiastes", 0, &["predikaren", "pred"]),
    b("SNG", "Höga visan", "Song of Solomon", 0, &["höga visan", "höga", "hv"]), b("ISA", "Jesaja", "Isaiah", 0, &["jesaja", "jes", "isa"]),
    b("JER", "Jeremia", "Jeremiah", 0, &["jeremia", "jer"]), b("LAM", "Klagovisorna", "Lamentations", 0, &["klagovisorna", "klag"]),
    b("EZK", "Hesekiel", "Ezekiel", 0, &["hesekiel", "hes"]), b("DAN", "Daniel", "Daniel", 0, &["daniel", "dan"]), b("HOS", "Hosea", "Hosea", 0, &["hosea", "hos"]),
    b("JOL", "Joel", "Joel", 0, &["joel"]), b("AMO", "Amos", "Amos", 0, &["amos"]), b("OBA", "Obadja", "Obadiah", 0, &["obadja", "ob"]),
    b("JON", "Jona", "Jonah", 0, &["jona"]), b("MIC", "Mika", "Micah", 0, &["mika", "mic"]), b("NAM", "Nahum", "Nahum", 0, &["nahum", "nah"]),
    b("HAB", "Habackuk", "Habakkuk", 0, &["habackuk", "hab"]), b("ZEP", "Sefanja", "Zephaniah", 0, &["sefanja", "sef"]),
    b("HAG", "Haggaj", "Haggai", 0, &["haggaj", "hag"]), b("ZEC", "Sakarja", "Zechariah", 0, &["sakarja", "sak"]), b("MAL", "Malaki", "Malachi", 0, &["malaki", "mal"]),
    b("MAT", "Matteus", "Matthew", 0, &["matteus", "matt", "mat", "matteusevangeliet"]), b("MRK", "Markus", "Mark", 0, &["markus", "mark", "mrk", "markusevangeliet"]),
    b("LUK", "Lukas", "Luke", 0, &["lukas", "luk", "lukasevangeliet"]), b("JHN", "Johannes", "John", 0, &["johannes", "joh", "johannesevangeliet"]),
    b("ACT", "Apostlagärningarna", "Acts", 0, &["apostlagärningarna", "apg"]), b("ROM", "Romarbrevet", "Romans", 0, &["romarbrevet", "rom"]),
    b("1CO", "1 Korintierbrevet", "1 Corinthians", 1, KOR), b("2CO", "2 Korintierbrevet", "2 Corinthians", 2, KOR),
    b("GAL", "Galaterbrevet", "Galatians", 0, &["galaterbrevet", "gal"]), b("EPH", "Efesierbrevet", "Ephesians", 0, &["efesierbrevet", "ef"]),
    b("PHP", "Filipperbrevet", "Philippians", 0, &["filipperbrevet", "fil"]), b("COL", "Kolosserbrevet", "Colossians", 0, &["kolosserbrevet", "kol"]),
    b("1TH", "1 Thessalonikerbrevet", "1 Thessalonians", 1, TESS), b("2TH", "2 Thessalonikerbrevet", "2 Thessalonians", 2, TESS),
    b("1TI", "1 Timoteusbrevet", "1 Timothy", 1, TIM), b("2TI", "2 Timoteusbrevet", "2 Timothy", 2, TIM), b("TIT", "Titus", "Titus", 0, &["titus", "tit"]),
    b("PHM", "Filemon", "Philemon", 0, &["filemon", "filem"]), b("HEB", "Hebreerbrevet", "Hebrews", 0, &["hebreerbrevet", "hebr", "heb"]),
    b("JAS", "Jakobsbrevet", "James", 0, &["jakob", "jak", "jakobsbrevet"]), b("1PE", "1 Petrusbrevet", "1 Peter", 1, PET), b("2PE", "2 Petrusbrevet", "2 Peter", 2, PET),
    b("1JN", "1 Johannesbrevet", "1 John", 1, JOHB), b("2JN", "2 Johannesbrevet", "2 John", 2, JOHB), b("3JN", "3 Johannesbrevet", "3 John", 3, JOHB),
    b("JUD", "Judasbrevet", "Jude", 0, &["judas", "jud", "judasbrevet"]), b("REV", "Uppenbarelseboken", "Revelation", 0, &["uppenbarelseboken", "upp", "upb"]),
];

/// The Pentateuch's names beside its numbered ones, as bible-books.ts lists them after the stems.
const EXTRA: [(&str, &[&str]); 5] = [("GEN", &["genesis", "gen"]), ("EXO", &["exodus", "exo"]), ("LEV", &["leviticus", "lev"]), ("NUM", &["numeri", "num"]), ("DEU", &["deuteronomium", "deu"])];

const ORDINALS: [[&str; 3]; 5] = [["1 ", "1:a ", "första "], ["2 ", "2:a ", "andra "], ["3 ", "3:e ", "tredje "], ["4 ", "4:e ", "fjärde "], ["5 ", "5:e ", "femte "]];

/// Every name a reference may use, in bible-books.ts's order (ties go to the first): the Swedish names and
/// abbreviations, then the English names (D12), then "psalm" and "song of songs".
fn aliases() -> Vec<(String, &'static str)> {
    let mut all: Vec<(String, &'static str)> = vec![];
    for book in &BOOKS {
        if book.n > 0 {
            for o in ORDINALS[book.n as usize - 1] { for s in book.aliases { all.push((format!("{o}{s}"), book.code)) } }
        } else {
            for a in book.aliases { all.push((a.to_string(), book.code)) }
        }
        if let Some((_, extra)) = EXTRA.iter().find(|(c, _)| *c == book.code) { for a in *extra { all.push((a.to_string(), book.code)) } }
    }
    all.extend(BOOKS.iter().map(|book| (book.en.to_lowercase(), book.code)));
    all.extend([("psalm".to_string(), "PSA"), ("song of songs".to_string(), "SNG")]);
    all
}

fn book(code: &str) -> Option<(usize, &'static Book)> { let c = code.to_uppercase(); BOOKS.iter().enumerate().find(|(_, b)| b.code == c) }

/// `swedishBookName`: a code we do not know shows as itself (spec 05 edge cases).
pub fn swedish_name(code: &str) -> String { book(code).map_or(code.to_string(), |(_, b)| b.sv.to_string()) }

/// `resolveBook`: a name or abbreviation to its code, case-insensitively (BIBLE-R11 step 5): an exact alias, else the
/// longest alias that starts with the input; none when nothing matches.
pub fn resolve(input: &str) -> Option<&'static str> {
    let q: String = input.nfc().collect::<String>().trim().to_lowercase();
    if q.is_empty() { return None }
    let all = aliases();
    if let Some((_, c)) = all.iter().find(|(a, _)| *a == q) { return Some(c) }
    let mut best: Option<&(String, &'static str)> = None;
    for e in &all { if e.0.starts_with(&q) && e.0.chars().count() > best.map_or(0, |b| b.0.chars().count()) { best = Some(e) } }
    best.map(|b| b.1)
}

/// The end of a chapter or a book, as bible.ts's `END` (Number.MAX_SAFE_INTEGER).
const END: i64 = 9_007_199_254_740_991;

/// `normaliseReference`: NFC, trimmed, one space between words, no spaces around ":" and "-" (BIBLE-R11 step 1).
fn normalise(query: &str) -> String {
    let words: Vec<String> = query.nfc().collect::<String>().split_whitespace().map(str::to_string).collect();
    let mut out = String::new();
    for c in words.join(" ").chars() {
        if (c == ':' || c == '-') && out.ends_with(' ') { out.pop(); }
        out.push(c);
    }
    out.replace(": ", ":").replace("- ", "-")
}

/// `B C[:V][-N[:M]][-|:]` after the book's space: the numbers, or none where the rest does not read so.
fn numbers(rest: &str) -> Option<(i64, Option<i64>, Option<i64>, Option<i64>)> {
    let digits = |s: &str| -> Option<(i64, usize)> { let n = s.bytes().take_while(u8::is_ascii_digit).count(); if n == 0 { None } else { s[..n].parse().ok().map(|v| (v, n)) } };
    let (c, mut i) = digits(rest)?;
    let mut v = None;
    if rest[i..].starts_with(':') { if let Some((x, n)) = digits(&rest[i + 1..]) { v = Some(x); i += 1 + n } }
    let (mut to, mut to_v) = (None, None);
    if rest[i..].starts_with('-') {
        if let Some((x, n)) = digits(&rest[i + 1..]) {
            to = Some(x); i += 1 + n;
            if rest[i..].starts_with(':') { if let Some((y, m)) = digits(&rest[i + 1..]) { to_v = Some(y); i += 1 + m } }
        }
    }
    let tail = &rest[i..];
    if tail.is_empty() || tail == "-" || tail == ":" { Some((c, v, to, to_v)) } else { None }
}

/// `planVerseSearch`: what a reference selects among the books `available` (BIBLE-R11): the books' codes and the
/// first and last chapter and verse, or none. A book that resolves but is not there selects nothing; one that does
/// not resolve looks in every book whose code starts with it.
pub fn plan(query: &str, available: &[String]) -> Option<Value> {
    let q = normalise(query);
    // The book is all before the last space whose rest reads as numbers (the regex's greedy `(.+)\s+`).
    let split = q.char_indices().filter(|(_, c)| *c == ' ').map(|(i, _)| i).rev().find_map(|i| numbers(&q[i + 1..]).map(|n| (&q[..i], n)));
    let Some((name, (c, v, to, to_v))) = split.filter(|(name, _)| !name.is_empty()) else {
        if q.is_empty() || !q.chars().all(|c| c.is_ascii_alphanumeric() || "åäöÅÄÖ: ".contains(c)) { return None }
        let code = resolve(&q)?;
        return available.iter().any(|a| a == code).then(|| json!({ "codes": [code], "from": [0, 0], "to": [END, END] }));
    };
    let name = name.trim();
    let codes: Vec<&String> = match resolve(name) {
        Some(code) => available.iter().filter(|a| *a == code).collect(),
        None => available.iter().filter(|a| a.to_uppercase().starts_with(&name.to_uppercase())).collect(),
    };
    if codes.is_empty() { return None }
    let to = match (to, to_v) {
        (None, _) => if v.is_some() && !q.ends_with('-') { [c, v.unwrap()] } else { [c, END] },
        (Some(n), Some(m)) => [n, m],
        (Some(n), None) if v.is_some_and(|v| n >= v) => [c, n],
        (Some(n), None) => [n, END],
    };
    Some(json!({ "codes": codes, "from": [c, v.unwrap_or(0)], "to": to }))
}

/// `verseSearchPlanView` {query, available}: the plan of a reference, or null (reads no database).
pub fn plan_view(a: &Obj) -> R<Value> {
    let query = a.get("query").and_then(Value::as_str).unwrap_or_default();
    let available: Vec<String> = a.get("available").and_then(Value::as_array).map(|x| x.iter().filter_map(|c| c.as_str().map(String::from)).collect()).unwrap_or_default();
    Ok(plan(query, &available).unwrap_or(Value::Null))
}

/// `bibleBookNamesView` {codes}: each book's Swedish and English name and its testament, in canonical order (BIBLE-R9,
/// R10), codes outside the 66 after, by code (reads no database).
pub fn names_view(a: &Obj) -> R<Value> {
    let mut codes: Vec<String> = a.get("codes").and_then(Value::as_array).map(|x| x.iter().filter_map(|c| c.as_str().map(String::from)).collect()).unwrap_or_default();
    codes.sort_by(|x, y| { let o = |c: &str| book(c).map_or(usize::MAX, |(i, _)| i); o(x).cmp(&o(y)).then_with(|| x.cmp(y)) });
    Ok(Value::Array(codes.into_iter().map(|c| {
        let found = book(&c);
        json!({ "code": c, "sv": found.map_or(c.clone(), |(_, b)| b.sv.to_string()), "en": found.map_or(c.clone(), |(_, b)| b.en.to_string()), "oldTestament": found.is_some_and(|(i, _)| i < 39) })
    }).collect()))
}
