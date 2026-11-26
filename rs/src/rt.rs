//! What every ported command shares: how it fails, how it prints, and when it
//! may still give the whole invocation back to the JavaScript.
//!
//! Rust reproduces the TypeScript for the inputs the TypeScript was written
//! for. Where the TypeScript's behaviour comes from the JavaScript runtime
//! instead (the text of a spawn failure, what happens to a value of the wrong
//! type, the wording of a file system error), a command returns
//! `Fail::Unsupported` and the invocation is handed back, as long as nothing
//! the user could notice has happened yet.

use std::io::Write as _;
use std::sync::atomic::{AtomicBool, Ordering};

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

/// Ends the process the way `main().catch(...)` in ts/cli.ts does.
pub fn finish(result: Result<i32, Fail>) -> ! {
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
