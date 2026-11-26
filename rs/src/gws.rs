//! The `gws` CLI: the only way gchat reaches Google. Port of ts/gws.ts.

use std::process::{Command, Stdio};

use crate::json::{self, js_prefix, js_trim, object, string, Json, ParseError};
use crate::rt::{self, null_access, unsupported, Fail, GwsError};

/// `process.env.GCHAT_GWS_BIN || "gws"`.
fn gws_bin() -> Result<String, Fail> {
    match std::env::var_os("GCHAT_GWS_BIN") {
        None => Ok("gws".to_string()),
        Some(value) if value.is_empty() => Ok("gws".to_string()),
        Some(value) => value.into_string().or_else(|_| unsupported("GCHAT_GWS_BIN is not valid Unicode")),
    }
}

struct RunResult {
    stdout: String,
    stderr: String,
    exit_code: i32,
}

/// The program to start for `bin`, or why Rust will not start it itself.
#[cfg(not(windows))]
fn program(bin: &str) -> Result<Command, String> {
    // No shell and no lookup of our own: the name goes to the system as it
    // is, which searches PATH for a bare name, as bun does.
    Ok(Command::new(bin))
}

/// On Windows bun looks a bare name up on PATH itself, trying `.exe`, `.cmd`
/// and `.bat` in each directory, and then starts what it found; a batch file
/// goes through cmd.exe, which reads the arguments by its own rules. Rust
/// starts the `.exe` itself when that is what bun would find. A batch file
/// (gws installed through npm is `gws.cmd`), or anything else unusual, is
/// left to the JavaScript, so the arguments reach gws exactly as before.
#[cfg(windows)]
fn program(bin: &str) -> Result<Command, String> {
    use std::path::{Path, PathBuf};
    let lower = bin.to_ascii_lowercase();
    let ext = |e: &str| lower.ends_with(e);
    if bin.contains(['/', '\\', ':']) {
        // A path: start it only if it plainly names an existing .exe.
        let path = Path::new(bin);
        return if path.is_absolute() && ext(".exe") && path.is_file() {
            Ok(Command::new(path))
        } else {
            Err(format!("\"{bin}\" is not an absolute path to an .exe"))
        };
    }
    let names: Vec<String> = if ext(".exe") || ext(".cmd") || ext(".bat") {
        vec![bin.to_string()]
    } else {
        vec![format!("{bin}.exe"), format!("{bin}.cmd"), format!("{bin}.bat")]
    };
    let path = std::env::var_os("PATH").unwrap_or_default();
    for dir in std::env::split_paths(&path) {
        if dir.as_os_str().is_empty() {
            continue;
        }
        for name in &names {
            let candidate: PathBuf = dir.join(name);
            if candidate.is_file() {
                return if name.to_ascii_lowercase().ends_with(".exe") {
                    Ok(Command::new(candidate))
                } else {
                    Err(format!("{} is a batch file", candidate.display()))
                };
            }
        }
    }
    Err(format!("\"{bin}\" was not found on PATH"))
}

/// What to tell the user when gws cannot be started and the JavaScript cannot
/// be asked to say it. In the TypeScript the middle of this sentence is the
/// JavaScript runtime's own error text; this is bun's wording where it is
/// known.
fn spawn_failure(bin: &str, detail: &str) -> Fail {
    let fail = format!("failed to run \"{bin}\": {detail}. Is gws installed and on PATH?");
    if rt::can_hand_back() {
        Fail::Unsupported(format!("gws error: {fail}"))
    } else {
        Fail::Gws(GwsError::new(fail))
    }
}

fn describe(bin: &str, error: &std::io::Error) -> String {
    use std::io::ErrorKind;
    let bare = !bin.contains(['/', '\\']);
    match error.kind() {
        ErrorKind::NotFound if bare => format!("Executable not found in $PATH: \"{bin}\""),
        ErrorKind::NotFound => format!("ENOENT: no such file or directory, posix_spawn '{bin}'"),
        ErrorKind::PermissionDenied => format!("EACCES: permission denied, posix_spawn '{bin}'"),
        _ => error.to_string(),
    }
}

/// Runs `gws <args...>` and captures what it prints. A non-zero exit is not
/// an error here: some gws errors still carry a useful JSON body.
fn run_gws(args: &[String], irreversible: bool) -> Result<RunResult, Fail> {
    let bin = gws_bin()?;
    let mut command = match program(&bin) {
        Ok(command) => command,
        Err(why) => return Err(spawn_failure(&bin, &why)),
    };
    command.args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let child = match command.spawn() {
        Ok(child) => child,
        Err(error) => return Err(spawn_failure(&bin, &describe(&bin, &error))),
    };
    // What this call does cannot be taken back, so neither can this run.
    if irreversible {
        rt::commit();
    }
    let output = match child.wait_with_output() {
        Ok(output) => output,
        Err(error) => return Err(Fail::Gws(GwsError::new(format!("failed to run \"{bin}\": {error}. Is gws installed and on PATH?")))),
    };
    Ok(RunResult {
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        // `exitCode ?? 1`: a gws killed by a signal has no exit code.
        exit_code: output.status.code().unwrap_or(1),
    })
}

/// Drops gws's noise lines so error messages stay readable.
fn clean_stderr(stderr: &str) -> String {
    let kept: Vec<&str> = stderr
        .split('\n')
        .filter(|line| {
            !js_trim(line).is_empty() && !line.get(..22).is_some_and(|head| head.eq_ignore_ascii_case("Using keyring backend:"))
        })
        .collect();
    js_trim(&kept.join("\n")).to_string()
}

/// Runs a gws command that prints one JSON value, and returns it (`Null` when
/// it printed nothing). Google's error envelope and a failed run become a
/// `GwsError`.
pub fn gws_json(args: &[String]) -> Result<Json, Fail> {
    gws_json_with(args, false)
}

fn gws_json_with(args: &[String], irreversible: bool) -> Result<Json, Fail> {
    let RunResult { stdout, stderr, exit_code } = run_gws(args, irreversible)?;
    let trimmed = js_trim(&stdout);

    let mut parsed = Json::Null;
    if !trimmed.is_empty() {
        let result = match json::parse(trimmed, false) {
            // Too late for the JavaScript to redo it: print what it would print.
            Err(ParseError::Unsupported(_)) if !rt::can_hand_back() => json::parse(trimmed, true),
            other => other,
        };
        parsed = match result {
            Ok(value) => value,
            Err(ParseError::Unsupported(why)) => return unsupported(why),
            Err(ParseError::Syntax) => {
                // Non-JSON stdout on a non-zero exit: surface stderr.
                let message = if exit_code != 0 {
                    let cleaned = clean_stderr(&stderr);
                    if cleaned.is_empty() { trimmed.to_string() } else { cleaned }
                } else {
                    format!("could not parse gws output as JSON: {}", js_prefix(trimmed, 200))
                };
                return Err(Fail::Gws(GwsError::new(message)));
            }
        };
    }

    // `env && env.error`: only null throws on a property read, and null is falsy.
    if parsed.truthy() {
        if let Some(error) = parsed.prop("error")?.filter(|e| e.truthy()) {
            let code = error.prop("code")?.cloned();
            let message = match error.prop_nullish("message")? {
                Some(message) => message.to_js_string(),
                None => "gws error".to_string(),
            };
            return Err(Fail::Gws(GwsError { code, message }));
        }
    }
    if exit_code != 0 {
        let cleaned = clean_stderr(&stderr);
        let message = if cleaned.is_empty() { format!("gws exited with code {exit_code}") } else { cleaned };
        return Err(Fail::Gws(GwsError::new(message)));
    }
    Ok(parsed)
}

fn args(words: &[&str], rest: Vec<String>) -> Vec<String> {
    words.iter().map(|w| w.to_string()).chain(rest).collect()
}

/// Lists the spaces the caller is a member of, following every page.
pub fn list_spaces() -> Result<Vec<Json>, Fail> {
    let mut spaces = Vec::new();
    let mut page_token: Option<Json> = None;
    loop {
        let mut params = object([("pageSize", Json::Num(100.0))]);
        if let (Json::Obj(params), Some(token)) = (&mut params, &page_token) {
            params.set("pageToken", token.clone());
        }
        let res = gws_json(&args(&["chat", "spaces", "list", "--params"], vec![params.compact()]))?;
        match res.prop("spaces").map_err(|_| null_access("res.spaces"))? {
            Some(Json::Arr(page)) => spaces.extend(page.iter().cloned()),
            // `if (res.spaces)`: anything falsy is no page.
            Some(other) if other.truthy() => return unsupported("gws returned `spaces` that is not a list"),
            _ => {}
        }
        page_token = res.prop("nextPageToken")?.filter(|t| t.truthy()).cloned();
        if page_token.is_none() {
            return Ok(spaces);
        }
    }
}

/// Asks for recent messages of a space, newest first, and returns
/// `res.messages ?? []` whatever it is.
pub fn list_messages_value(space_name: &str, page_size: f64) -> Result<Json, Fail> {
    let params = object([
        ("parent", string(space_name)),
        ("pageSize", Json::Num(page_size)),
        ("orderBy", string("createTime desc")),
    ]);
    let res = gws_json(&args(&["chat", "spaces", "messages", "list", "--params"], vec![params.compact()]))?;
    // gws printed nothing: the TypeError of `res.messages`, which bun words
    // with the source text of the whole `await` it stands for.
    let messages = res.prop_nullish("messages").map_err(|_| {
        null_access(concat!(
            "(await gwsJson([\n",
            "    \"chat\",\n",
            "    \"spaces\",\n",
            "    \"messages\",\n",
            "    \"list\",\n",
            "    \"--params\",\n",
            "    JSON.stringify({ parent: spaceName, pageSize, orderBy: \"createTime desc\" })\n",
            "  ])).messages"
        ))
    })?;
    Ok(messages.cloned().unwrap_or(Json::Arr(Vec::new())))
}

/// Lists recent messages of a space, newest first.
pub fn list_messages(space_name: &str, page_size: f64) -> Result<Vec<Json>, Fail> {
    match list_messages_value(space_name, page_size)? {
        Json::Arr(messages) => Ok(messages),
        _ => unsupported("gws returned `messages` that is not a list"),
    }
}

/// Posts a message; with `thread_id`, as a reply into that thread.
pub fn send_message(space_name: &str, text: &str, thread_id: Option<&str>, dry_run: bool) -> Result<Json, Fail> {
    let mut params = json::Object::new();
    params.set("parent", string(space_name));
    let mut body = json::Object::new();
    body.set("text", string(text));
    if let Some(thread_id) = thread_id {
        params.set("messageReplyOption", string("REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD"));
        body.set("thread", object([("name", string(&format!("{space_name}/threads/{thread_id}")))]));
    }
    let mut rest = vec![Json::Obj(params).compact(), "--json".to_string(), Json::Obj(body).compact()];
    if dry_run {
        rest.push("--dry-run".to_string());
    }
    // Posting a message is the one call that must not be made twice.
    gws_json_with(&args(&["chat", "spaces", "messages", "create", "--params"], rest), true)
}

pub fn auth_status() -> Result<Json, Fail> {
    gws_json(&args(&["auth", "status"], Vec::new()))
}

/// The caller's own Chat user name ("users/<id>"), from the People API, or
/// `None` if it cannot be determined. The TypeScript catches every error here.
pub fn get_self_user_id() -> Result<Option<String>, Fail> {
    let params = object([("resourceName", string("people/me")), ("personFields", string("metadata"))]);
    let me = match gws_json(&args(&["people", "people", "get", "--params"], vec![params.compact()])) {
        Ok(me) => me,
        Err(Fail::Unsupported(why)) => return unsupported(why),
        Err(_) => return Ok(None),
    };
    // From here on a wrong shape is a TypeError in the TypeScript, caught the
    // same way: no id.
    let Ok(metadata) = me.prop("metadata") else { return Ok(None) };
    let sources = match metadata {
        None | Some(Json::Null) => return Ok(None),
        Some(metadata) => match metadata.prop_nullish("sources") {
            Ok(None) => return Ok(None),
            Ok(Some(Json::Arr(sources))) => sources,
            _ => return Ok(None),
        },
    };
    // `sources.find(s => s.type === wanted)`, twice; a null entry reached
    // before a match throws.
    let find = |wanted: &str| -> Result<Option<&Json>, ()> {
        for source in sources {
            if source.prop("type").map_err(|_| ())?.and_then(Json::as_str) == Some(wanted) {
                return Ok(Some(source));
            }
        }
        Ok(None)
    };
    let profile = match find("PROFILE") {
        Ok(Some(profile)) => Some(profile),
        Ok(None) => match find("DOMAIN_PROFILE") {
            Ok(profile) => profile,
            Err(()) => return Ok(None),
        },
        Err(()) => return Ok(None),
    };
    let id = profile.and_then(|p| p.prop("id").ok().flatten()).filter(|id| id.truthy());
    Ok(id.map(|id| format!("users/{}", id.to_js_string())))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keyring_noise_is_dropped() {
        assert_eq!(clean_stderr("Using keyring backend: keyring\n"), "");
        assert_eq!(clean_stderr("\n  \nerror: x\nusing KEYRING backend: file\n  hint  \n\n"), "error: x\n  hint");
        assert_eq!(clean_stderr(" Using keyring backend: indented stays"), "Using keyring backend: indented stays");
    }
}
