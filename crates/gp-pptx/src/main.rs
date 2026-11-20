//! `gp-pptx DECK.pptx OUT_DIR MAX_PAGES`: every slide shown at every click, written to OUT_DIR as `NNN-full.jpg` and
//! `NNN-thumb.jpg`, and on stdout one JSON line, {"charts", "pages": [{"slide", "click", "full", "thumb"}]} (the file
//! names). A deck that does not read exits 2 with the reason on stderr; one of more than MAX_PAGES pages, the clicks
//! counted, exits 3 as soon as it is known. The desktop host runs it (apps/desktop/src/pptx.ts).
use gp_pptx::Refused;
use std::process::ExitCode;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().collect();
    let [_, deck, out, max] = args.as_slice() else {
        eprintln!("usage: gp-pptx DECK.pptx OUT_DIR MAX_PAGES");
        return ExitCode::from(64);
    };
    let Ok(max) = max.parse::<usize>() else {
        eprintln!("MAX_PAGES is a number: {max}");
        return ExitCode::from(64);
    };
    let bytes = match std::fs::read(deck) {
        Ok(b) => b,
        Err(e) => {
            eprintln!("{deck}: {e}");
            return ExitCode::from(66);
        }
    };
    let deck = match gp_pptx::pages(&bytes, max) {
        Ok(d) => d,
        Err(Refused::Invalid(e)) => {
            eprintln!("{e}");
            return ExitCode::from(2);
        }
        Err(Refused::TooMany) => {
            eprintln!("more than {max} pages");
            return ExitCode::from(3);
        }
    };
    let mut pages = vec![];
    for (n, p) in deck.pages.iter().enumerate() {
        let (full, thumb) = (format!("{n:03}-full.jpg"), format!("{n:03}-thumb.jpg"));
        for (name, bytes) in [(&full, &p.full), (&thumb, &p.thumb)] {
            if let Err(e) = std::fs::write(format!("{out}/{name}"), bytes) {
                eprintln!("{out}/{name}: {e}");
                return ExitCode::from(73);
            }
        }
        pages.push(serde_json::json!({ "slide": p.slide, "click": p.click, "full": full, "thumb": thumb }));
    }
    println!("{}", serde_json::json!({ "charts": deck.charts, "pages": pages }));
    ExitCode::SUCCESS
}
