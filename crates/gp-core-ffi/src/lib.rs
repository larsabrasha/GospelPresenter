// The Rust core's interface for the native shells, through UniFFI (docs/native-apps.md): the same steps as the web's
// C functions in crates/gp-core/src/bridge.rs, as Swift (and later Kotlin) types generated from these. The core
// still asks its shell for every statement and waits for the rows; only how a step crosses over differs.
//
// What stays JSON text: a command's arguments and a view's answer, which the core reads and writes as JSON for the web
// as well; the shell decodes a view's answer into its own types.
use gp_core::Step as CoreStep;
use serde_json::{json, Value};

uniffi::setup_scaffolding!();

/// A value of SQLite's, as the core sends parameters and the shell answers rows. A blob never crosses: the core reads
/// no bytes, and the shell answers a blob as null.
#[derive(uniffi::Enum, Clone, Debug, PartialEq)]
pub enum SqlValue {
    Null,
    Integer { value: i64 },
    Real { value: f64 },
    Text { value: String },
}

/// Who calls: the device's user and role, and the server's clock where it decides (`now`, milliseconds).
#[derive(uniffi::Record, Clone, Debug)]
pub struct Caller {
    pub user_id: String,
    pub role: String,
    pub now: Option<f64>,
}

/// Where a call stands.
#[derive(uniffi::Enum, Clone, Debug, PartialEq)]
pub enum Step {
    /// Done: a view's answer as JSON text; none for a command.
    Done { json: Option<String> },
    /// Refused: the code (`forbidden`, `not-found`, `invalid-args`, `sql-error: …`).
    Refused { code: String },
    /// A statement to run in the shell's transaction; `resume` with its rows.
    Sql { sql: String, params: Vec<SqlValue> },
}

/// The shell's answer to a statement.
#[derive(uniffi::Enum, Clone, Debug)]
pub enum SqlAnswer {
    Rows { rows: Vec<Vec<SqlValue>> },
    /// SQLite refused it: its message. The core runs nothing more and fails the command as `sql-error`.
    Failed { message: String },
}

/// Starts the command or view `name` with its arguments (a JSON object's text). Every `resume` of the call must come
/// on the thread that started it; one call at a time.
#[uniffi::export]
pub fn start(name: String, args: String, caller: Option<Caller>) -> Step {
    let Ok(args) = serde_json::from_str::<Value>(&args) else { return Step::Refused { code: "invalid-args".into() } };
    let ctx = caller.map_or(json!({}), |c| json!({ "userId": c.user_id, "role": c.role, "now": c.now }));
    step(gp_core::start(json!({ "name": name, "args": args, "ctx": ctx })))
}

/// The rows of the statement the call asked for, or SQLite's refusal of it.
#[uniffi::export]
pub fn resume(answer: SqlAnswer) -> Step {
    step(gp_core::resume(match answer {
        SqlAnswer::Rows { rows } => Ok(rows.into_iter().map(|r| r.into_iter().map(to_json).collect()).collect()),
        SqlAnswer::Failed { message } => Err(message),
    }))
}

fn step(s: CoreStep) -> Step {
    match s {
        CoreStep::Done(Value::Null) => Step::Done { json: None },
        CoreStep::Done(v) => Step::Done { json: Some(v.to_string()) },
        CoreStep::Refused(code) => Step::Refused { code },
        CoreStep::Sql(sql, params) => Step::Sql { sql, params: params.into_iter().map(to_sql).collect() },
    }
}

/// The largest integer a JavaScript number holds exactly.
const SAFE: f64 = 9_007_199_254_740_991.0;

/// A row's value as the web's worker hands it to the core, through JavaScript's numbers and `JSON.stringify`: a whole
/// REAL is written as an integer, and NaN or an infinity as null.
fn to_json(v: SqlValue) -> Value {
    match v {
        SqlValue::Null => Value::Null,
        SqlValue::Integer { value } => json!(value),
        SqlValue::Real { value } if !value.is_finite() => Value::Null,
        SqlValue::Real { value } if value.fract() == 0.0 && value.abs() <= SAFE => json!(value as i64),
        SqlValue::Real { value } => json!(value),
        SqlValue::Text { value } => Value::String(value),
    }
}

/// A parameter as the web's SQLite binds it: a whole number as an integer, true and false as 1 and 0.
fn to_sql(v: Value) -> SqlValue {
    match v {
        Value::Null => SqlValue::Null,
        Value::Bool(b) => SqlValue::Integer { value: b as i64 },
        Value::Number(n) => match (n.as_i64(), n.as_f64()) {
            (Some(i), _) => SqlValue::Integer { value: i },
            (None, Some(f)) if f.fract() == 0.0 && f.abs() <= SAFE => SqlValue::Integer { value: f as i64 },
            (None, Some(f)) => SqlValue::Real { value: f },
            (None, None) => SqlValue::Null,
        },
        Value::String(s) => SqlValue::Text { value: s },
        other => SqlValue::Text { value: other.to_string() },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_whole_real_reaches_the_core_as_an_integer() {
        assert_eq!(to_json(SqlValue::Real { value: 3.0 }), json!(3));
    }

    #[test]
    fn a_fractional_real_reaches_the_core_as_it_is() {
        assert_eq!(to_json(SqlValue::Real { value: 2.5 }), json!(2.5));
    }

    #[test]
    fn a_whole_number_parameter_is_bound_as_an_integer() {
        assert_eq!(to_sql(json!(4.0)), SqlValue::Integer { value: 4 });
    }

    #[test]
    fn a_boolean_parameter_is_bound_as_one_or_zero() {
        assert_eq!(to_sql(json!(true)), SqlValue::Integer { value: 1 });
    }

    #[test]
    fn arguments_that_are_not_json_are_refused() {
        assert_eq!(start("presentationsView".into(), "{".into(), None), Step::Refused { code: "invalid-args".into() });
    }

    #[test]
    fn a_view_asks_for_its_statement_then_answers_from_the_rows() {
        let first = start("trashView".into(), "{}".into(), None);
        assert!(matches!(first, Step::Sql { .. }));

        let done = resume(SqlAnswer::Rows { rows: vec![vec![
            SqlValue::Text { value: "p1".into() }, SqlValue::Text { value: "Gudstjänst".into() }, SqlValue::Integer { value: 5 },
        ]] });

        assert_eq!(done, Step::Done { json: Some(r#"[{"deletedAt":5,"id":"p1","name":"Gudstjänst"}]"#.into()) });
    }

    #[test]
    fn a_statement_sqlite_refused_fails_the_command() {
        start("trashView".into(), "{}".into(), None);

        let done = resume(SqlAnswer::Failed { message: "no such table: presentations".into() });

        assert_eq!(done, Step::Refused { code: "sql-error: no such table: presentations".into() });
    }
}
