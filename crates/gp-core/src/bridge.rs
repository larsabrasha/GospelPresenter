// The shell bridge: the core asks the shell to run SQL and waits for the rows (a Crux-style effect).
// Two doors onto the same steps: the C functions below, JSON in and out (the web's WASM), and `start`/`resume`,
// which crates/gp-core-ffi exports to Swift through UniFFI.
use serde_json::{json, Value};
use std::cell::RefCell;
use std::future::Future;
use std::pin::Pin;
use std::task::{Context, Poll, Waker};

pub type Rows = Vec<Vec<Value>>;
type Task = Pin<Box<dyn Future<Output = Result<Value, String>>>>;

thread_local! {
    static REQUEST: RefCell<Option<(String, Vec<Value>)>> = RefCell::new(None);
    static RESPONSE: RefCell<Option<Rows>> = RefCell::new(None);
    static TASK: RefCell<Option<Task>> = RefCell::new(None);
    static OUT: RefCell<String> = RefCell::new(String::new());
    /// A statement the shell could not run (its SQLite's message): every statement after it is skipped.
    static FAILED: RefCell<Option<String>> = RefCell::new(None);
}

#[cfg(target_arch = "wasm32")]
extern "C" {
    fn now_ms() -> f64;
}
/// The shell's clock in milliseconds: JavaScript's `Date.now()` under WASM, the system's elsewhere, whole as that is.
#[cfg(target_arch = "wasm32")]
pub fn now() -> f64 { unsafe { now_ms() } }
#[cfg(not(target_arch = "wasm32"))]
pub fn now() -> f64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0.0, |d| d.as_millis() as f64)
}

struct Query { req: Option<(String, Vec<Value>)> }
impl Future for Query {
    type Output = Rows;
    fn poll(mut self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<Rows> {
        if let Some(r) = self.req.take() {
            if FAILED.with(|f| f.borrow().is_some()) { return Poll::Ready(vec![]) }
            REQUEST.with(|q| *q.borrow_mut() = Some(r));
            return Poll::Pending;
        }
        match RESPONSE.with(|r| r.borrow_mut().take()) { Some(rows) => Poll::Ready(rows), None => Poll::Pending }
    }
}

/// Runs `sql` in the shell's transaction; its rows as arrays.
pub fn sql(sql: &str, params: Vec<Value>) -> impl Future<Output = Rows> {
    Query { req: Some((sql.to_string(), params)) }
}

/// The statement the shell could not run since the command began, if one failed; cleared, so statements run again.
pub fn take_failure() -> Option<String> { FAILED.with(|f| f.borrow_mut().take()) }

/// Where a call of the core stands after a step.
pub enum Step {
    /// Done: what it answers (a view's JSON; null for a mutation).
    Done(Value),
    /// Refused: the code.
    Refused(String),
    /// It wants a statement run: the SQL and its parameters; `resume` with the rows.
    Sql(String, Vec<Value>),
}

fn drive() -> Step {
    let mut cx = Context::from_waker(Waker::noop());
    let res = TASK.with(|t| t.borrow_mut().as_mut().map(|f| f.as_mut().poll(&mut cx)));
    match res {
        Some(Poll::Ready(r)) => {
            TASK.with(|t| *t.borrow_mut() = None);
            // A statement the shell could not run fails the command, whatever the core made of the rows it did not get.
            match take_failure() { Some(e) => Step::Refused(format!("sql-error: {e}")), None => match r { Ok(v) => Step::Done(v), Err(code) => Step::Refused(code) } }
        }
        Some(Poll::Pending) => { let (sql, params) = REQUEST.with(|q| q.borrow_mut().take()).unwrap(); Step::Sql(sql, params) }
        None => Step::Refused("no-task".into()),
    }
}

/// Starts a mutation or a view, `{"name", "args", "ctx"}`, on this thread; every `resume` of it must come on this
/// thread too, as the call waits in the thread's own state.
pub fn start(input: Value) -> Step {
    FAILED.with(|f| *f.borrow_mut() = None);
    let task: Task = Box::pin(crate::mutators::run(input));
    TASK.with(|t| *t.borrow_mut() = Some(task));
    drive()
}

/// The rows of the statement asked for, or the message of the shell's SQLite when it refused it.
pub fn resume(answer: Result<Rows, String>) -> Step {
    let rows = answer.unwrap_or_else(|e| {
        FAILED.with(|f| *f.borrow_mut() = Some(e));
        vec![]
    });
    RESPONSE.with(|r| *r.borrow_mut() = Some(rows));
    drive()
}

// ------------------------------------------------------------ the C functions, JSON in and out (the web's WASM)

fn set_out(s: String) { OUT.with(|o| *o.borrow_mut() = s); }

/// 0: done; 1: refused, the code in OUT; 2: wants SQL, the request in OUT.
fn status(step: Step) -> u32 {
    match step {
        Step::Done(Value::Null) => { set_out(String::new()); 0 }
        Step::Done(v) => { set_out(v.to_string()); 0 }
        Step::Refused(code) => { set_out(code); 1 }
        Step::Sql(sql, params) => { set_out(json!({ "sql": sql, "params": params }).to_string()); 2 }
    }
}

fn read(ptr: *mut u8, len: usize) -> String {
    String::from_utf8(unsafe { Vec::from_raw_parts(ptr, len, len) }).unwrap()
}

#[no_mangle]
pub extern "C" fn gp_alloc(len: usize) -> *mut u8 {
    let mut v = Vec::<u8>::with_capacity(len.max(1));
    let p = v.as_mut_ptr();
    std::mem::forget(v);
    p
}

/// Starts a mutation or a view: {"name", "args", "ctx"}. A view answers its JSON in OUT.
#[no_mangle]
pub extern "C" fn gp_start(ptr: *mut u8, len: usize) -> u32 {
    status(start(serde_json::from_str(&read(ptr, len)).unwrap()))
}

/// The rows of the SQL asked for, as a JSON array of arrays; or `{"error": "…"}` when the shell's SQLite refused it.
#[no_mangle]
pub extern "C" fn gp_resume(ptr: *mut u8, len: usize) -> u32 {
    status(resume(match serde_json::from_str::<Value>(&read(ptr, len)).unwrap() {
        Value::Object(o) => Err(o.get("error").and_then(Value::as_str).unwrap_or("").to_string()),
        v => Ok(serde_json::from_value(v).unwrap()),
    }))
}

#[no_mangle]
pub extern "C" fn gp_out_ptr() -> *const u8 { OUT.with(|o| o.borrow().as_ptr()) }
#[no_mangle]
pub extern "C" fn gp_out_len() -> usize { OUT.with(|o| o.borrow().len()) }

/// A face of the system's for slideLayoutView (`slide_layout::add_face`): {"name", "family", "data" (base64)}. 0 when
/// added, 1 when the JSON does not read.
#[cfg(feature = "layout")]
#[no_mangle]
pub extern "C" fn gp_add_face(ptr: *mut u8, len: usize) -> u32 {
    let v: Value = serde_json::from_str(&read(ptr, len)).unwrap_or(Value::Null);
    let text = |k: &str| v.get(k).and_then(Value::as_str).map(str::to_string);
    let data = text("data").as_deref().and_then(crate::files::base64);
    let (Some(name), Some(family), Some(data)) = (text("name"), text("family"), data) else { return 1 };
    crate::slide_layout::add_face(name, family, data);
    0
}
