// The shell's half of the core's bridge (crates/gp-core/src/bridge.rs): SQLite in-process, answering each statement
// the core asks for, as the Mac app's Shell.swift does through UniFFI. Here the core is linked in, so its `start` and
// `resume` are called directly, and a value crosses as JSON as the web's worker hands it over.
use gp_core::{resume, start, Rows, Step};
use rusqlite::types::{Value as Sql, ValueRef};
use rusqlite::Connection;
use serde_json::{json, Value};

/// Who calls: the device's user and role (the demo's, as the Mac app's demo runs with).
pub struct Caller {
    pub user_id: String,
    pub role: String,
}

/// The Rust core, run on a database. One call at a time, on the thread that opened it: a call waits in the thread's
/// own state between its steps.
pub struct Core {
    db: Connection,
    caller: Caller,
}

impl Core {
    /// The database at `path`, opened in WAL as the Mac app opens its own, and migrated to the core's schema
    /// (`migrateOrgSchema`, in one transaction: a database it refuses is left as it was).
    pub fn open(path: &str, caller: Caller) -> Result<Core, String> {
        let db = Connection::open(path).map_err(|e| format!("{path}: {e}"))?;
        db.query_row("PRAGMA journal_mode = WAL", [], |_| Ok(())).map_err(|e| e.to_string())?;
        let core = Core { db, caller };
        core.command("migrateOrgSchema", json!({}))?;
        Ok(core)
    }

    /// Runs one call of the core to its end, answering each statement from the database: what it answered (a view's
    /// JSON, null for a command), or its refusal's code. Runs in whatever transaction the caller holds.
    pub fn call(&self, name: &str, args: Value) -> Result<Value, String> {
        let ctx = json!({ "userId": self.caller.user_id, "role": self.caller.role });
        let mut step = start(json!({ "name": name, "args": args, "ctx": ctx }));
        loop {
            match step {
                Step::Done(v) => return Ok(v),
                Step::Refused(code) => return Err(code),
                Step::Sql(sql, params) => step = resume(self.query(&sql, &params)),
            }
        }
    }

    /// A command in a transaction of its own, rolled back when the core refuses it or the commit fails (a foreign
    /// key a change left broken), as Shell.swift's `command` does.
    pub fn command(&self, name: &str, args: Value) -> Result<Value, String> {
        self.db.execute_batch("BEGIN").map_err(|e| format!("sql-error: {e}"))?;
        let done = self.call(name, args).and_then(|v| self.db.execute_batch("COMMIT").map(|()| v).map_err(|e| format!("sql-error: {e}")));
        if done.is_err() { let _ = self.db.execute_batch("ROLLBACK"); }
        done
    }

    /// A view's answer, decoded; None when the core refuses or the answer does not decode as `T`.
    pub fn view<T: serde::de::DeserializeOwned>(&self, name: &str, args: Value) -> Option<T> {
        self.call(name, args).ok().and_then(|v| serde_json::from_value(v).ok())
    }

    /// One statement's rows as arrays of JSON values, or SQLite's message.
    fn query(&self, sql: &str, params: &[Value]) -> Result<Rows, String> {
        let mut st = self.db.prepare_cached(sql).map_err(|e| e.to_string())?;
        let width = st.column_count();
        let bound: Vec<Sql> = params.iter().map(to_sql).collect();
        let mut rows = st.query(rusqlite::params_from_iter(bound)).map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        while let Some(row) = rows.next().map_err(|e| e.to_string())? {
            out.push((0..width).map(|c| row.get_ref(c).map_or(Value::Null, to_json)).collect());
        }
        Ok(out)
    }
}

/// The largest integer a JavaScript number holds exactly.
const SAFE: f64 = 9_007_199_254_740_991.0;

/// A row's value as the web's worker hands it to the core, through JavaScript's numbers and `JSON.stringify`: a whole
/// REAL as an integer, NaN or an infinity as null, and a blob as null (the core reads no bytes). The same as
/// crates/gp-core-ffi's `to_json`.
pub fn to_json(v: ValueRef<'_>) -> Value {
    match v {
        ValueRef::Null | ValueRef::Blob(_) => Value::Null,
        ValueRef::Integer(n) => json!(n),
        ValueRef::Real(x) if !x.is_finite() => Value::Null,
        ValueRef::Real(x) if x.fract() == 0.0 && x.abs() <= SAFE => json!(x as i64),
        ValueRef::Real(x) => json!(x),
        ValueRef::Text(t) => Value::String(String::from_utf8_lossy(t).into_owned()),
    }
}

/// A parameter as the web's SQLite binds it: a whole number as an integer, true and false as 1 and 0, anything else
/// as its JSON text. The same as crates/gp-core-ffi's `to_sql`.
pub fn to_sql(v: &Value) -> Sql {
    match v {
        Value::Null => Sql::Null,
        Value::Bool(b) => Sql::Integer(*b as i64),
        Value::Number(n) => match (n.as_i64(), n.as_f64()) {
            (Some(i), _) => Sql::Integer(i),
            (None, Some(f)) if f.fract() == 0.0 && f.abs() <= SAFE => Sql::Integer(f as i64),
            (None, Some(f)) => Sql::Real(f),
            (None, None) => Sql::Null,
        },
        Value::String(s) => Sql::Text(s.clone()),
        other => Sql::Text(other.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_whole_real_reaches_the_core_as_an_integer() {
        // Arrange, Act
        let v = to_json(ValueRef::Real(3.0));

        // Assert
        assert_eq!(v, json!(3));
    }

    #[test]
    fn a_blob_reaches_the_core_as_null() {
        // Arrange, Act
        let v = to_json(ValueRef::Blob(&[1, 2]));

        // Assert
        assert_eq!(v, Value::Null);
    }

    #[test]
    fn a_boolean_parameter_binds_as_an_integer() {
        // Arrange, Act
        let v = to_sql(&json!(true));

        // Assert
        assert_eq!(v, Sql::Integer(1));
    }

    #[test]
    fn a_whole_float_parameter_binds_as_an_integer() {
        // Arrange, Act
        let v = to_sql(&json!(1700000000000.0));

        // Assert
        assert_eq!(v, Sql::Integer(1_700_000_000_000));
    }
}
