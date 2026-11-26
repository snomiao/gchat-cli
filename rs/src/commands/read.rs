//! `gchat read <space>` — the last N messages. Port of ts/commands/read.ts.

use crate::args::{self, Kind, Opt, Spec};
use crate::format::format_message;
use crate::gws::list_messages;
use crate::json::Json;
use crate::resolver::{resolve_space, space_id, split_thread};
use crate::rt::{out, Fail};

const SPEC: Spec = Spec {
    options: &[
        Opt { long: "limit", short: Some("n"), kind: Kind::Int },
        Opt { long: "format", short: None, kind: Kind::Choice(&["text", "json"]) },
    ],
    flags: &[],
};

pub fn command(rest: &[String]) -> Option<impl FnOnce() -> Result<i32, Fail>> {
    let parsed = args::parse(rest, &SPEC)?;
    let [space] = parsed.positionals.as_slice() else { return None };
    let space = space.clone();
    let limit: i64 = parsed.value("limit").map_or(Some(20), |n| n.parse().ok())?;
    let json = parsed.value("format") == Some("json");
    Some(move || run(&space, limit, json))
}

/// `messages.slice(0, limit)`: a negative limit counts from the end.
pub fn first(messages: &[Json], limit: i64) -> &[Json] {
    let len = messages.len() as i64;
    let end = if limit < 0 { (len + limit).max(0) } else { limit.min(len) };
    &messages[..end as usize]
}

/// The lines for `messages`, which are in the order to print.
pub fn format_messages(messages: &[&Json], space_id: &str) -> Result<Vec<String>, Fail> {
    messages.iter().map(|m| format_message(m, space_id)).collect()
}

fn run(space: &str, limit: i64, json: bool) -> Result<i32, Fail> {
    // Accept "<space>:<thread>" too, but read is space-wide — drop the thread part.
    let (space_arg, _) = split_thread(space);
    let space = resolve_space(space_arg)?;
    let messages = list_messages(&space.name, limit.max(1) as f64)?;
    // API returns newest-first; show oldest-first like a chat transcript.
    let ordered: Vec<&Json> = first(&messages, limit).iter().rev().collect();

    if json {
        out(&Json::Arr(ordered.into_iter().cloned().collect()).pretty());
        return Ok(0);
    }
    if ordered.is_empty() {
        out("(no messages)");
        return Ok(0);
    }
    out(&format_messages(&ordered, space_id(&space.name))?.join("\n"));
    Ok(0)
}
