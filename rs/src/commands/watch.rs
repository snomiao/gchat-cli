//! `gchat watch <space1> <space2> ...`
//! Tail multiple spaces concurrently; each printed line is prefixed with a
//! name. Port of ts/commands/watch.ts.

use crate::args::{self, Kind, Opt, Spec};
use crate::commands::tail::{tail_space, Tail};
use crate::resolver::{resolve_space, space_id, split_thread};
use crate::rt::{self, Fail};

const SPEC: Spec = Spec {
    options: &[
        Opt { long: "limit", short: Some("n"), kind: Kind::Int },
        Opt { long: "interval", short: None, kind: Kind::Decimal },
        Opt { long: "format", short: None, kind: Kind::Choice(&["text", "json"]) },
    ],
    flags: &[],
};

pub fn command(rest: &[String]) -> Option<impl FnOnce() -> Result<i32, Fail>> {
    let parsed = args::parse(rest, &SPEC)?;
    if parsed.positionals.is_empty() {
        return None;
    }
    let limit: i64 = parsed.value("limit").map_or(Some(10), |n| n.parse().ok())?;
    let interval: f64 = parsed.value("interval").map_or(Some(20.0), |n| n.parse().ok())?;
    if interval > crate::commands::tail::MAX_INTERVAL_SEC {
        return None;
    }
    let json = parsed.value("format") == Some("json");
    let spaces = parsed.positionals;
    Some(move || run(spaces, limit, interval, json))
}

fn run(spaces: Vec<String>, limit: i64, interval: f64, json: bool) -> Result<i32, Fail> {
    // Every argument is resolved at once (each asks gws for the space list if
    // the cache does not have it), and the first one to fail ends the command.
    let resolved: Vec<(String, String)> = rt::all(spaces, |arg| {
        let (space_arg, _) = split_thread(&arg);
        let space = resolve_space(space_arg).unwrap_or_else(|fail| rt::fail(fail));
        let label = if space.display_name.is_empty() { space_id(&space.name).to_string() } else { space.display_name };
        (space.name, label)
    });

    // One tail per space. None of them ends by itself; one that fails before
    // it is under way ends the command.
    rt::all(resolved, move |(name, label)| {
        let tail = Tail {
            space_name: &name,
            initial_limit: limit,
            interval_sec: interval,
            json,
            prefix: Some(&label),
            exit_on_message: false,
            timeout_sec: None,
            self_user_id: None,
        };
        tail_space(&tail).unwrap_or_else(|fail| rt::fail(fail))
    });
    Ok(0)
}
