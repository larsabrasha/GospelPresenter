// The views' JSON Schema, for the shells' generated types (docs/view-models.md, "Typed"): run by schema/generate.sh.
fn main() {
    println!("{}", serde_json::to_string_pretty(&gp_core::view_types::schema()).unwrap_or_default());
}
