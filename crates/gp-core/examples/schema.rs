// The views' JSON Schema, for the shells' generated types (docs/view-models.md, "Typed"):
// `cargo run -p gp-core --example schema --features schema > crates/gp-core/schema/views.json`.
use gp_core::view_types::*;
use schemars::schema_for;

fn main() {
    // One schema whose definitions are every type a shell reads; the root names them so none is left out.
    #[derive(schemars::JsonSchema)]
    #[allow(dead_code)]
    struct Views { start_page: Vec<StartList>, date_line: DateLine }
    println!("{}", serde_json::to_string_pretty(&schema_for!(Views)).unwrap());
}
