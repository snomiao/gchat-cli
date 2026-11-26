//! `gchat tail <space> [-n N] [--interval SEC] [--exit-on-message] [--timeout DUR]`
//! Print last N messages, then poll and print new ones (dedup by message name).
//!
//! --exit-on-message turns tail into a "wait for reply": it skips the backlog
//! and exits 0 as soon as the first new message *from someone other than you*
//! arrives. --timeout DUR auto-stops after that long (exit 0 even if nothing
//! arrived). Port of ts/commands/tail.ts.

use std::time::Duration;

use crate::args::{self, Kind, Opt, Spec};
use crate::commands::read::first;
use crate::config::now_ms;
use crate::format::format_message;
use crate::gws::{get_self_user_id, list_messages, list_messages_value};
use crate::json::{is_js_whitespace, js_trim, Json, Object};
use crate::resolver::{resolve_space, space_id, split_thread};
use crate::rt::{self, err, not_a_function, null_access, out, Fail};

const SPEC: Spec = Spec {
    options: &[
        Opt { long: "limit", short: Some("n"), kind: Kind::Int },
        Opt { long: "interval", short: None, kind: Kind::Decimal },
        Opt { long: "timeout", short: None, kind: Kind::Text },
        Opt { long: "format", short: None, kind: Kind::Choice(&["text", "json"]) },
    ],
    flags: &["exit-on-message"],
};

/// The longest `setTimeout` takes: past it the JavaScript timer fires at once.
const MAX_INTERVAL_SEC: f64 = 2_147_483.0;

pub fn command(rest: &[String]) -> Option<impl FnOnce() -> Result<i32, Fail>> {
    let parsed = args::parse(rest, &SPEC)?;
    let [space] = parsed.positionals.as_slice() else { return None };
    let space = space.clone();
    let limit: i64 = parsed.value("limit").map_or(Some(10), |n| n.parse().ok())?;
    let interval: f64 = parsed.value("interval").map_or(Some(20.0), |n| n.parse().ok())?;
    if interval > MAX_INTERVAL_SEC {
        return None;
    }
    let timeout = parsed.value("timeout").map(str::to_string);
    let json = parsed.value("format") == Some("json");
    let exit_on_message = parsed.flag("exit-on-message");
    Some(move || run(&space, limit, interval, json, exit_on_message, timeout.as_deref()))
}

/// Parse a duration like "300", "90s", "30m", "2h", "1d" → seconds. Bare
/// numbers are seconds. `/^(\d+(?:\.\d+)?)\s*([smhd]?)$/` on the trimmed input.
pub fn parse_duration(input: &str) -> Result<f64, Fail> {
    let invalid = || Fail::Error(format!("invalid duration \"{input}\" (use e.g. 90s, 30m, 2h, 1d)"));
    let text = js_trim(input);
    let digits = |from: &str| from.bytes().take_while(u8::is_ascii_digit).count();
    let mut number = digits(text);
    if number == 0 {
        return Err(invalid());
    }
    if let Some(fraction) = text[number..].strip_prefix('.') {
        match digits(fraction) {
            // A dot without digits is not part of the number, and nothing else may follow.
            0 => return Err(invalid()),
            n => number += 1 + n,
        }
    }
    let seconds = match text[number..].trim_start_matches(is_js_whitespace) {
        "" | "s" => 1.0,
        "m" => 60.0,
        "h" => 3600.0,
        "d" => 86400.0,
        _ => return Err(invalid()),
    };
    text[..number].parse::<f64>().map(|n| n * seconds).map_err(|_| invalid())
}

fn run(space: &str, limit: i64, interval: f64, json: bool, exit_on_message: bool, timeout: Option<&str>) -> Result<i32, Fail> {
    let (space_arg, _) = split_thread(space);
    let space = resolve_space(space_arg)?;
    // Only need the self-id when we must exclude our own messages.
    let self_user_id = if exit_on_message { get_self_user_id()? } else { None };
    let timeout_sec = timeout.map(parse_duration).transpose()?;
    tail_space(&Tail { space_name: &space.name, initial_limit: limit, interval_sec: interval, json, prefix: None, exit_on_message, timeout_sec, self_user_id })
}

pub struct Tail<'a> {
    pub space_name: &'a str,
    pub initial_limit: i64,
    pub interval_sec: f64,
    pub json: bool,
    pub prefix: Option<&'a str>,
    pub exit_on_message: bool,
    pub timeout_sec: Option<f64>,
    pub self_user_id: Option<String>,
}

/// What the `Set` of seen messages holds for a message: its `name`, whatever
/// that is. A list or an object is only ever equal to itself, so it is never
/// found again.
#[derive(Clone, PartialEq)]
enum Name {
    Undefined,
    Value(Json),
    NeverEqual,
}

fn name_of(m: &Json) -> Result<Name, Fail> {
    Ok(match m.prop("name").map_err(|_| null_access("m.name"))? {
        None => Name::Undefined,
        Some(Json::Arr(_) | Json::Obj(_)) => Name::NeverEqual,
        Some(value) => Name::Value(value.clone()),
    })
}

/// One printed line for a message: the text form, or the message as JSON.
fn render(m: &Json, tail: &Tail, lenient: bool) -> Result<String, Fail> {
    if !tail.json {
        let head = tail.prefix.filter(|p| !p.is_empty()).map_or(String::new(), |p| format!("[{p}] "));
        return Ok(format!("{head}{}", format_message(m, space_id(tail.space_name), lenient)?));
    }
    let Some(prefix) = tail.prefix.filter(|p| !p.is_empty()) else { return Ok(m.compact()) };
    // `{ space: prefix, ...m }`: the message's own properties follow, and a
    // `space` of its own replaces the value but not the place.
    let mut line = Object::new();
    line.set("space", Json::Str(prefix.to_string()));
    match m {
        Json::Obj(object) => object.entries().for_each(|(key, value)| line.set(&key, value.clone())),
        Json::Arr(items) => items.iter().enumerate().for_each(|(i, value)| line.set(&i.to_string(), value.clone())),
        Json::Str(text) => {
            let mut units = [0u16; 2];
            let mut i = 0;
            for c in text.chars() {
                for unit in c.encode_utf16(&mut units) {
                    line.set(&i.to_string(), Json::Str(String::from_utf16_lossy(&[*unit])));
                    i += 1;
                }
            }
        }
        _ => {}
    }
    Ok(Json::Obj(line).compact())
}

fn sleep(ms: f64) {
    if ms > 0.0 {
        std::thread::sleep(Duration::from_secs_f64(ms / 1000.0));
    }
}

pub fn tail_space(tail: &Tail) -> Result<i32, Fail> {
    let deadline = tail.timeout_sec.map_or(f64::INFINITY, |seconds| now_ms() + seconds * 1000.0);

    // Seed the dedup set with existing messages. Print the backlog only in
    // plain tail mode — when waiting (exit-on-message / timeout) we care
    // about genuinely new messages, so the backlog is silently seeded.
    let listed = list_messages(tail.space_name, tail.initial_limit.max(1) as f64)?;
    let initial: Vec<&Json> = first(&listed, tail.initial_limit).iter().rev().collect();
    let mut seen: Vec<Name> = Vec::new();
    for m in &initial {
        seen.push(name_of(m)?);
    }
    let backlog: Vec<String> = if !tail.exit_on_message && tail.timeout_sec.is_none() {
        initial.iter().map(|m| render(m, tail, false)).collect::<Result<_, _>>()?
    } else {
        Vec::new()
    };
    // From here the tail is under way: a second process could not pick up
    // where this one is, so nothing is handed back any more.
    rt::commit();
    for line in &backlog {
        out(line);
    }

    loop {
        if now_ms() >= deadline {
            return Ok(0); // --timeout reached (exit 0)
        }
        sleep((tail.interval_sec * 1000.0).min((deadline - now_ms()).max(0.0)));
        if now_ms() >= deadline {
            return Ok(0);
        }
        match poll(tail, &mut seen) {
            Ok(true) => return Ok(0),
            Ok(false) => {}
            Err(Fail::Gws(e)) => err(&format!("[tail {}] poll error: {}", space_id(tail.space_name), e.message)),
            Err(Fail::Error(message) | Fail::Unsupported(message)) => err(&format!("[tail {}] poll error: {message}", space_id(tail.space_name))),
        }
    }
}

/// One poll: prints what is new. `Ok(true)` when the wait is over. An `Err`
/// is what the TypeScript's `catch` around a poll reports and carries on from.
fn poll(tail: &Tail, seen: &mut Vec<Name>) -> Result<bool, Fail> {
    let fresh = match list_messages_value(tail.space_name, 25.0)? {
        Json::Arr(messages) => messages,
        _ => {
            let call = "(await listMessages(spaceName, 25)).reverse";
            return Err(not_a_function(call, &format!("{call}()")));
        }
    };
    // `fresh.filter(m => !seen.has(m.name))`, then all of them join the set:
    // a message listed twice in one answer is new twice.
    let mut new_ones: Vec<(&Json, Name)> = Vec::new();
    for m in fresh.iter().rev() {
        let name = name_of(m)?;
        if name == Name::NeverEqual || !seen.contains(&name) {
            new_ones.push((m, name));
        }
    }
    seen.extend(new_ones.iter().map(|(_, name)| name.clone()));
    // Line by line, so an error leaves the lines before it printed.
    for (m, _) in &new_ones {
        out(&render(m, tail, true)?);
    }
    // Exit once a reply from someone other than us lands. If we couldn't
    // resolve our own id, any new message counts.
    if tail.exit_on_message {
        let from_other = new_ones.iter().any(|(m, _)| {
            let sender = m.prop_nullish("sender").ok().flatten().and_then(|s| s.prop("name").ok().flatten()).and_then(Json::as_str);
            tail.self_user_id.is_none() || sender != tail.self_user_id.as_deref()
        });
        if from_other {
            return Ok(true);
        }
    }
    Ok(false)
}

#[cfg(test)]
mod tests {
    use super::parse_duration;

    #[test]
    fn durations() {
        for (text, seconds) in [("300", 300.0), ("0", 0.0), ("90s", 90.0), ("30m", 1800.0), ("2h", 7200.0), ("1d", 86400.0), (" 5m ", 300.0), ("1.5h", 5400.0), ("5 m", 300.0), ("00", 0.0)] {
            assert_eq!(parse_duration(text).ok(), Some(seconds), "{text}");
        }
        for text in ["soon", "10x", "", "1e3", ".5", "5.", "1.5.2", "-5", "5 minutes", "1h30m", "s"] {
            assert!(parse_duration(text).is_err(), "{text}");
        }
    }
}
