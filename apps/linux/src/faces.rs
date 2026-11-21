// The faces slides are painted with: the core's own by a run's name (`slide_face`), and the system's for Classic's
// stack, added to the core so it lays out with the very faces painted (SlidePainter.swift's SlideFaces does the same
// on a Mac). A browser on Linux draws `'Tahoma', 'Geneva', Verdana, sans-serif` with the first of those fontconfig
// has, and with fontconfig's sans-serif where it has none (DejaVu Sans on a bare Arch), so this adds the same.
use cairo::FontFace;
use std::cell::RefCell;
use std::collections::HashMap;
use std::process::Command;

/// Classic's stack's named families (themes.ts's FONT_STACKS.tahoma), in its order, then its generic family.
const STACK: [&str; 3] = ["Tahoma", "Geneva", "Verdana"];
const GENERIC: &str = "sans-serif";

thread_local! {
    static FACES: RefCell<HashMap<String, Option<FontFace>>> = RefCell::new(HashMap::new());
    static LIBRARY: freetype::Library = freetype::Library::init().expect("FreeType");
}

/// One face's file and PostScript name, as fontconfig lists them.
struct Found {
    file: String,
    name: String,
}

/// fontconfig's files for `pattern`, through its own tools: `fc-list` for a family it has (none when it has not),
/// `fc-match` for what it substitutes.
fn fontconfig(tool: &str, pattern: &str) -> Vec<Found> {
    let Ok(out) = Command::new(tool).args([pattern, "--format", "%{file}\t%{postscriptname}\n"]).output() else { return vec![] };
    String::from_utf8_lossy(&out.stdout).lines().filter_map(|l| {
        let (file, name) = l.split_once('\t')?;
        (file.ends_with(".ttf") || file.ends_with(".otf")).then(|| Found { file: file.into(), name: name.into() })
    }).collect()
}

/// The system's faces for Classic, added to the core once: every face of the first family of the stack the system
/// has, else fontconfig's sans-serif in its regular and bold, under the family name the stack gives.
pub fn prepare() {
    thread_local! { static DONE: RefCell<bool> = const { RefCell::new(false) }; }
    if DONE.with(|d| d.replace(true)) { return }
    let (family, found) = STACK.iter().map(|f| (*f, fontconfig("fc-list", &format!(":family={f}"))))
        .find(|(_, found)| !found.is_empty())
        .unwrap_or_else(|| (GENERIC, [GENERIC, "sans-serif:bold"].iter().flat_map(|p| fontconfig("fc-match", p)).collect()));
    for f in found {
        let Ok(bytes) = std::fs::read(&f.file) else { continue };
        gp_core::add_slide_face(f.name.clone(), family.to_string(), bytes.clone());
        let face = load(bytes);
        FACES.with(|faces| faces.borrow_mut().insert(f.name, face));
    }
}

fn load(bytes: Vec<u8>) -> Option<FontFace> {
    let face = LIBRARY.with(|lib| lib.new_memory_face(bytes, 0)).ok()?;
    FontFace::create_from_ft(&face).ok()
}

/// A run's face: one added from the system, or the core's own.
pub fn face(name: &str) -> Option<FontFace> {
    FACES.with(|faces| {
        faces.borrow_mut().entry(name.to_string()).or_insert_with(|| gp_core::slide_face(name).and_then(|b| load(b.to_vec()))).clone()
    })
}
