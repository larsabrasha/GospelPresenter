// The app's UI texts (apps/web/src/i18n.ts), Swedish and English, as JSON in OUT_DIR for src/texts.rs: one table for
// the web, the native apps and this shell, so a text is written once (apps/mac/texts.mjs does the same for Swift).
// Node reads the TypeScript (its own type stripping, Node 22.6 and later), as texts.mjs does.
use std::path::PathBuf;
use std::process::Command;

fn main() {
    let here = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    let i18n = here.join("../../apps/web/src/i18n.ts").canonicalize().expect("apps/web/src/i18n.ts, the app's texts");
    let out = PathBuf::from(std::env::var("OUT_DIR").unwrap()).join("texts.json");
    println!("cargo:rerun-if-changed={}", i18n.display());
    let url = format!("file://{}", i18n.display());
    let script = format!(
        "const {{ texts }} = await import({url:?}); process.stdout.write(JSON.stringify(texts));"
    );
    let run = Command::new("node")
        .args(["--input-type=module", "--no-warnings", "-e", &script])
        .output()
        .expect("node, to read apps/web/src/i18n.ts (Node 22.6 or later)");
    assert!(run.status.success(), "node could not read i18n.ts: {}", String::from_utf8_lossy(&run.stderr));
    std::fs::write(&out, &run.stdout).unwrap();
}
