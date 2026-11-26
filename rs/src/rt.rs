//! What every ported command shares: how it fails, how it prints, and when it
//! may still give the whole invocation back to the JavaScript.
//!
//! Rust reproduces the TypeScript for the inputs the TypeScript was written
//! for. Where the TypeScript's behaviour comes from the JavaScript runtime
//! instead (the text of a spawn failure, what happens to a value of the wrong
//! type, the wording of a file system error), a command returns
//! `Fail::Unsupported` and the invocation is handed back, as long as nothing
//! the user could notice has happened yet.

use std::cell::RefCell;
use std::io::Write as _;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex, MutexGuard};

use crate::json::Json;

/// An error from gws: Google's `{"error": {...}}` envelope or a failed run.
#[derive(Debug)]
pub struct GwsError {
    /// `error.code` as gws printed it, if any.
    pub code: Option<Json>,
    pub message: String,
}

impl GwsError {
    pub fn new(message: impl Into<String>) -> Self {
        GwsError { code: None, message: message.into() }
    }

    /// A missing OAuth scope: `code === 403` and the message says so.
    pub fn is_scope(&self) -> bool {
        matches!(self.code, Some(Json::Num(n)) if n == 403.0)
            && self.message.to_ascii_lowercase().contains("insufficient authentication scopes")
    }
}

#[derive(Debug)]
pub enum Fail {
    /// `throw new GwsError(...)`.
    Gws(GwsError),
    /// `throw new Error(message)`.
    Error(String),
    /// Something whose outcome in the TypeScript is decided by the JavaScript
    /// runtime. Never caught by the ported `try`/`catch` blocks.
    Unsupported(String),
}

impl From<crate::json::NullAccess> for Fail {
    fn from(_: crate::json::NullAccess) -> Self {
        Fail::Unsupported("gws returned null where an object was expected".to_string())
    }
}

/// Reading `expression` threw because the object was null: the TypeError of
/// the TypeScript, in bun's words. The text matters where it can still reach
/// the user (a poll error of a running tail, a standalone binary).
pub fn null_access(expression: &str) -> Fail {
    Fail::Unsupported(format!("null is not an object (evaluating '{expression}')"))
}

/// Calling `method` on `expression` threw because the value has no such
/// method (it is not a string, or not a list), again in bun's words.
pub fn not_a_function(expression: &str, call: &str) -> Fail {
    Fail::Unsupported(format!("{expression} is not a function. (In '{call}', '{expression}' is undefined)"))
}

pub fn unsupported<T>(why: impl Into<String>) -> Result<T, Fail> {
    Err(Fail::Unsupported(why.into()))
}

/// Set once the user (or Google) could notice that this process did
/// something: a line was printed, a message was posted, a tail started
/// waiting. From then on the invocation cannot be handed back, because the
/// JavaScript would do it all a second time.
static COMMITTED: AtomicBool = AtomicBool::new(false);

pub fn commit() {
    COMMITTED.store(true, Ordering::SeqCst);
}

/// Whether the invocation can still go to the JavaScript: nothing noticeable
/// has happened, and this binary was installed with the JavaScript.
pub fn can_hand_back() -> bool {
    !COMMITTED.load(Ordering::SeqCst) && crate::js_fallback::package_root().is_some()
}

/// `console.log(line)`. A closed pipe is ignored, as bun ignores it.
pub fn out(line: &str) {
    commit();
    let mut stdout = std::io::stdout().lock();
    let _ = stdout.write_all(line.as_bytes()).and_then(|_| stdout.write_all(b"\n")).and_then(|_| stdout.flush());
}

/// `console.error(line)`.
pub fn err(line: &str) {
    commit();
    let mut stderr = std::io::stderr().lock();
    let _ = stderr.write_all(line.as_bytes()).and_then(|_| stderr.write_all(b"\n"));
}

// ── several things at once, the way JavaScript does them ─────────────────────
//
// `watch` runs several tails at once. In JavaScript that is one thread: a
// task runs until it waits for something outside (a gws process, a timer),
// and only then does another task run. Here every task is a thread, and the
// turn below is what makes them behave like that: a task holds it while it
// runs and gives it up only while it waits. A command that does one thing at
// a time never takes it, and nothing below costs it anything.

static TURN: Mutex<()> = Mutex::new(());
/// Held while tasks are being started, so that a task that has finished
/// waiting cannot run before all of them have had their first turn (as none
/// can in JavaScript before `items.map(async …)` has gone through the list).
static STARTING: Mutex<()> = Mutex::new(());

thread_local! {
    static MY_TURN: RefCell<Option<MutexGuard<'static, ()>>> = const { RefCell::new(None) };
    /// Tells whoever started this task that it has reached its first wait.
    static FIRST_WAIT: RefCell<Option<mpsc::Sender<()>>> = const { RefCell::new(None) };
}

fn lock(mutex: &'static Mutex<()>) -> MutexGuard<'static, ()> {
    mutex.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn take_turn() {
    let turn = lock(&TURN);
    MY_TURN.with(|mine| *mine.borrow_mut() = Some(turn));
}

fn give_turn() -> bool {
    MY_TURN.with(|mine| mine.borrow_mut().take()).is_some()
}

fn reached_first_wait() {
    if let Some(started) = FIRST_WAIT.with(|first| first.borrow_mut().take()) {
        let _ = started.send(());
    }
}

/// Waits for something outside this process (`await` on a child process or a
/// timer). Other tasks run meanwhile.
pub fn waiting<T>(wait: impl FnOnce() -> T) -> T {
    reached_first_wait();
    let had_turn = give_turn();
    let value = wait();
    if had_turn {
        drop(lock(&STARTING));
        take_turn();
    }
    value
}

/// `await Promise.all(items.map(async (item) => task(item)))`: every task is
/// started in order and runs up to its first wait before the next one starts;
/// the results come back in the order of the items. A task that fails ends
/// the process itself (see `fail`), which is what a rejection does here.
pub fn all<T, R>(items: Vec<T>, task: impl Fn(T) -> R + Send + Sync + 'static) -> Vec<R>
where
    T: Send + 'static,
    R: Send + 'static,
{
    let task = Arc::new(task);
    if MY_TURN.with(|mine| mine.borrow().is_none()) {
        take_turn();
    }
    let starting = lock(&STARTING);
    let mut tasks = Vec::new();
    for item in items {
        let (started, has_started) = mpsc::channel();
        let task = Arc::clone(&task);
        tasks.push(std::thread::spawn(move || {
            take_turn();
            FIRST_WAIT.with(|first| *first.borrow_mut() = Some(started));
            let result = task(item);
            reached_first_wait();
            give_turn();
            result
        }));
        give_turn();
        // Err when the task ended without waiting or without returning.
        let _ = has_started.recv();
        take_turn();
    }
    drop(starting);
    tasks.into_iter().map(|task| waiting(|| task.join()).unwrap_or_else(|_| std::process::exit(101))).collect()
}

/// Ends the process for a failed task, as an uncaught rejection does.
pub fn fail(fail: Fail) -> ! {
    finish(Err(fail))
}

/// Runs a ported command to its end.
///
/// A bug in a ported command must not cost the user their command: a panic
/// while the invocation can still be handed back hands it back, silently.
pub fn run(command: impl FnOnce() -> Result<i32, Fail>) -> ! {
    let report = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        if !can_hand_back() {
            report(info);
        }
    }));
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(command)) {
        Ok(result) => finish(result),
        Err(_) if can_hand_back() => crate::js_fallback::run(crate::JS_ENTRY),
        Err(_) => std::process::exit(101),
    }
}

/// Ends the process the way `main().catch(...)` in ts/cli.ts does.
fn finish(result: Result<i32, Fail>) -> ! {
    let code = match result {
        Ok(code) => code,
        Err(Fail::Gws(e)) => {
            if e.is_scope() {
                err("gchat: missing OAuth scope (403). Run: gchat auth");
            } else {
                let code = match &e.code {
                    Some(code) if code.truthy() => format!(" {}", code.to_js_string()),
                    _ => String::new(),
                };
                err(&format!("gchat: gws error{code}: {}", crate::json::js_prefix(&e.message, 300)));
            }
            1
        }
        Err(Fail::Error(message)) => {
            err(&format!("gchat: {message}"));
            1
        }
        Err(Fail::Unsupported(why)) => {
            if can_hand_back() {
                crate::js_fallback::run(crate::JS_ENTRY);
            }
            // No JavaScript to ask (a standalone binary), or too late to ask.
            err(&format!("gchat: {why}"));
            1
        }
    };
    std::process::exit(code)
}
