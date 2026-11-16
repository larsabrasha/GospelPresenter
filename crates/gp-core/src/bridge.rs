// The shell bridge: the core asks the shell to run SQL and waits for the rows (a Crux-style effect).
use serde_json::{json, Value};
use std::cell::RefCell;
use std::future::Future;
use std::pin::Pin;
use std::task::{Context, Poll, Waker};

pub type Rows = Vec<Vec<Value>>;
type Task = Pin<Box<dyn Future<Output = Result<Value, String>>>>;

thread_local! {
    static REQUEST: RefCell<Option<Value>> = RefCell::new(None);
    static RESPONSE: RefCell<Option<Rows>> = RefCell::new(None);
    static TASK: RefCell<Option<Task>> = RefCell::new(None);
    static OUT: RefCell<String> = RefCell::new(String::new());
    /// A statement the shell could not run (its SQLite's message): every statement after it is skipped.
    static FAILED: RefCell<Option<String>> = RefCell::new(None);
}

extern "C" {
    fn now_ms() -> f64;
}
pub fn now() -> f64 { unsafe { now_ms() } }

struct Query { req: Option<Value> }
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
    Query { req: Some(json!({ "sql": sql, "params": params })) }
}

/// The statement the shell could not run since the command began, if one failed; cleared, so statements run again.
pub fn take_failure() -> Option<String> { FAILED.with(|f| f.borrow_mut().take()) }

fn set_out(s: String) { OUT.with(|o| *o.borrow_mut() = s); }

/// 0: done; 1: refused, the code in OUT; 2: wants SQL, the request in OUT.
fn drive() -> u32 {
    let mut cx = Context::from_waker(Waker::noop());
    let res = TASK.with(|t| t.borrow_mut().as_mut().map(|f| f.as_mut().poll(&mut cx)));
    match res {
        Some(Poll::Ready(r)) => {
            TASK.with(|t| *t.borrow_mut() = None);
            // A statement the shell could not run fails the command, whatever the core made of the rows it did not get.
            let r = match take_failure() { Some(e) => Err(format!("sql-error: {e}")), None => r };
            match r { Ok(Value::Null) => { set_out(String::new()); 0 } Ok(v) => { set_out(v.to_string()); 0 } Err(code) => { set_out(code); 1 } }
        }
        Some(Poll::Pending) => { set_out(REQUEST.with(|q| q.borrow_mut().take()).unwrap().to_string()); 2 }
        None => { set_out("no-task".into()); 1 }
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
    let input: Value = serde_json::from_str(&read(ptr, len)).unwrap();
    FAILED.with(|f| *f.borrow_mut() = None);
    let task: Task = Box::pin(crate::mutators::run(input));
    TASK.with(|t| *t.borrow_mut() = Some(task));
    drive()
}

/// The rows of the SQL asked for, as a JSON array of arrays; or `{"error": "…"}` when the shell's SQLite refused it.
#[no_mangle]
pub extern "C" fn gp_resume(ptr: *mut u8, len: usize) -> u32 {
    let rows: Rows = match serde_json::from_str::<Value>(&read(ptr, len)).unwrap() {
        Value::Object(o) => {
            FAILED.with(|f| *f.borrow_mut() = Some(o.get("error").and_then(Value::as_str).unwrap_or("").to_string()));
            vec![]
        }
        v => serde_json::from_value(v).unwrap(),
    };
    RESPONSE.with(|r| *r.borrow_mut() = Some(rows));
    drive()
}

#[no_mangle]
pub extern "C" fn gp_out_ptr() -> *const u8 { OUT.with(|o| o.borrow().as_ptr()) }
#[no_mangle]
pub extern "C" fn gp_out_len() -> usize { OUT.with(|o| o.borrow().len()) }
