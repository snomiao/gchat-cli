//! `gchat send <space[:threadId]> "<msg>" [--code XXXX]`
//!
//! Two-step confirm guard: the first call reads the space's recent messages,
//! prints them + a summary + a --code=XXXX, and stashes the intent. Re-run
//! within the TTL with --code to actually post. Port of ts/commands/send.ts.

use sha2::{Digest, Sha256};

use crate::args::{self, Kind, Opt, Spec};
use crate::config::{exists, fs_failure, now_ms, pending_path, read_json};
use crate::format::{format_message, thread_id_of};
use crate::gws::{list_messages, send_message};
use crate::json::{object, string, Json};
use crate::resolver::{resolve_space, space_id, split_thread};
use crate::rt::{err, out, unsupported, Fail};

const PENDING_TTL_MS: f64 = 60_000.0;

const SPEC: Spec = Spec { options: &[Opt { long: "code", short: None, kind: Kind::Text }], flags: &["dry-run"] };

pub fn command(rest: &[String]) -> Option<impl FnOnce() -> Result<i32, Fail>> {
    let parsed = args::parse(rest, &SPEC)?;
    let [space, message] = parsed.positionals.as_slice() else { return None };
    let (space, message) = (space.clone(), message.clone());
    let code = parsed.value("code").map(str::to_string);
    let dry_run = parsed.flag("dry-run");
    Some(move || run(&space, &message, code.as_deref(), dry_run))
}

/// The confirm code: the first 8 hex digits of sha256("<target>\0<message>").
fn intent_hash(target: &str, message: &str) -> String {
    let digest = Sha256::digest(format!("{target}\0{message}").as_bytes());
    digest.iter().take(4).map(|byte| format!("{byte:02x}")).collect()
}

/// The text Node and bun give a failed file operation.
fn node_error(error: &std::io::Error, syscall: &str, path: &str) -> String {
    use std::io::ErrorKind;
    let what = match error.kind() {
        ErrorKind::NotFound => "ENOENT: no such file or directory".to_string(),
        ErrorKind::PermissionDenied => "EACCES: permission denied".to_string(),
        ErrorKind::IsADirectory => "EISDIR: illegal operation on a directory".to_string(),
        ErrorKind::ReadOnlyFilesystem => "EROFS: read-only file system".to_string(),
        _ => error.to_string(),
    };
    format!("{what}, {syscall} '{path}'")
}

/// Best-effort recent-context block for the confirm gate. Fail-soft: if the
/// space can't be resolved / read (bad name, missing scope), the code is
/// still minted so the flow isn't blocked — errors resurface at confirm time.
fn context(space_arg: &str, thread_id: Option<&str>, message: &str) -> Result<Vec<String>, Fail> {
    let mut recent: Vec<String> = Vec::new();
    let mut dest = space_arg.to_string();
    // The `try` block of the TypeScript: any error it catches ends the block.
    let attempt = (|| -> Result<(), Fail> {
        let space = resolve_space(space_arg)?;
        dest = if space.display_name.is_empty() { space.name.clone() } else { format!("{} ({})", space.display_name, space.name) };
        let messages = list_messages(&space.name, 3.0)?;
        for m in messages.iter().take(3).rev() {
            recent.push(format!("  {}", format_message(m, space_id(&space.name))?));
        }
        Ok(())
    })();
    match attempt {
        Ok(()) | Err(Fail::Gws(_) | Fail::Error(_)) => {}
        Err(unsupported) => return Err(unsupported),
    }

    let mut lines = vec!["--- Recent messages ----------------------------".to_string()];
    if recent.is_empty() {
        lines.push("  (space context unavailable)".to_string());
    } else {
        lines.append(&mut recent);
    }
    lines.push("--- Sending ------------------------------------".to_string());
    lines.push(format!("  → space: {dest}"));
    lines.push(match thread_id {
        Some(thread_id) => format!("  → thread reply: {thread_id}"),
        None => "  → new thread".to_string(),
    });
    lines.push(format!("  Message: {message}"));
    lines.push("------------------------------------------------".to_string());
    Ok(lines)
}

/// `writeFileSync(path, text, { mode: 0o600 })`: the mode is for a new file.
fn write_private(path: &str, text: &str) -> std::io::Result<()> {
    use std::io::Write as _;
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    options.open(path)?.write_all(text.as_bytes())
}

fn run(space: &str, message: &str, code: Option<&str>, dry_run: bool) -> Result<i32, Fail> {
    let (space_arg, thread_id) = split_thread(space);
    let hash = intent_hash(space, message);
    let path = pending_path(&hash)?;

    let Some(code) = code else {
        // Everything that can still fail comes before the first line is
        // printed, so a failure here can be handed back whole.
        let lines = context(space_arg, thread_id, message)?;
        let pending = object([("space_arg", string(space)), ("message", string(message)), ("created_at", Json::Num(now_ms()))]);
        write_private(&path, &pending.compact()).map_err(|e| fs_failure("write", &path, &e))?;
        out(&lines.join("\n"));
        out(&format!("Re-run within {}s with --code={hash} to send.", PENDING_TTL_MS / 1000.0));
        return Ok(0);
    };

    if code != hash {
        err(&format!("code mismatch: expected {hash}, got {code}"));
        return Ok(1);
    }
    if !exists(&path) {
        err(&format!("no pending intent for code={hash}. Re-run without --code to start over."));
        return Ok(1);
    }
    // `Date.now() - pending.created_at > PENDING_TTL_MS`; a file without the
    // field never expires (the difference is NaN).
    let Some(pending) = read_json(&path)? else { return unsupported(format!("cannot read {path} as JSON")) };
    let expired = match pending.prop("created_at")? {
        None => false,
        Some(Json::Num(created_at)) => now_ms() - created_at > PENDING_TTL_MS,
        Some(_) => return unsupported("a pending send whose created_at is not a number"),
    };
    if expired {
        std::fs::remove_file(&path).map_err(|e| fs_failure("remove", &path, &e))?;
        err(&format!("pending intent expired (>{}s). Re-run without --code.", PENDING_TTL_MS / 1000.0));
        return Ok(1);
    }

    let space = resolve_space(space_arg)?;
    let result = match send_message(&space.name, message, thread_id, dry_run) {
        Ok(result) => result,
        Err(Fail::Gws(e)) if e.is_scope() => {
            err("✗ missing scope for chat.messages.create. Check: gchat auth\n  Re-authorize gws with the chat.messages.create scope.");
            // keep pending file so the user can retry after fixing scopes
            return Ok(3);
        }
        Err(other) => return Err(other),
    };
    // From here the message is out; what fails now fails the way it does in
    // the TypeScript, with the text bun gives it.
    std::fs::remove_file(&path).map_err(|e| Fail::Error(node_error(&e, "unlink", &path)))?;
    if dry_run {
        let thread = thread_id.map_or(String::new(), |t| format!(":{t}"));
        out(&format!("✓ dry-run OK (nothing sent) → {}{thread}", space.name));
        return Ok(0);
    }
    let thread = thread_id_of(&result).map_err(|type_error| Fail::Error(type_error.0))?;
    out(&format!("✓ sent to {} (reply with: gchat send \"{}:{thread}\" \"...\")", space.name, space_id(&space.name)));
    Ok(0)
}

#[cfg(test)]
mod tests {
    use super::intent_hash;

    #[test]
    fn confirm_code() {
        // createHash("sha256").update("spaces/X\x00hello").digest("hex").slice(0, 8)
        assert_eq!(intent_hash("spaces/X", "hello"), "aca08405");
    }
}
