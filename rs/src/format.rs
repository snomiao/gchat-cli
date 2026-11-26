//! Human-readable rendering of spaces and messages. Port of ts/format.ts.
//!
//! The TypeScript trusts gws to return the fields as Google documents them.
//! Rust renders exactly those shapes; for anything else (a number where a
//! string belongs, a date in another notation) it reports `Unsupported`, and
//! the caller hands the invocation back while that is still possible.

use jiff::civil::Date;
use jiff::tz::{Offset, TimeZone};

use crate::json::{is_js_whitespace, js_len, js_suffix, Json};
use crate::resolver::space_id;
use crate::rt::{unsupported, Fail};

/// What JavaScript throws when a value has the wrong type, with the text bun
/// prints for it. Only `gchat send` shows one: after a message was posted
/// there is no handing back.
pub struct TypeError(pub String);

impl From<TypeError> for Fail {
    fn from(error: TypeError) -> Self {
        Fail::Unsupported(error.0)
    }
}

/// The time zone `Date` uses for local time. The JavaScript runtime finds it
/// through ICU and Rust through the tz database; they agree for a zone named
/// in `TZ` and for the system's zone, and other `TZ` forms are not taken on.
fn local_zone() -> Result<TimeZone, Fail> {
    match std::env::var_os("TZ") {
        Some(tz) => match tz.to_str().filter(|name| !name.is_empty()).map(TimeZone::get) {
            Some(Ok(zone)) => Ok(zone),
            _ => unsupported(format!("TZ={} is not the name of a time zone", tz.to_string_lossy())),
        },
        None => TimeZone::try_system().or_else(|e| unsupported(format!("no system time zone: {e}"))),
    }
}

fn two(text: &str) -> Option<i8> {
    let bytes = text.as_bytes();
    (bytes.len() == 2 && bytes.iter().all(u8::is_ascii_digit)).then(|| text.parse().ok()).flatten()
}

/// Seconds since the epoch for `YYYY-MM-DDTHH:MM:SS[.fraction](Z|±HH:MM)`,
/// the notation Google uses. `Date` accepts much more (other separators, days
/// past the end of a month, no zone at all); none of that is taken on here.
fn parse_timestamp(iso: &str) -> Option<i64> {
    if !iso.is_ascii() || iso.len() < 20 {
        return None;
    }
    let (date, time) = iso.split_at(10);
    let (year, month, day) = (date.get(0..4)?, two(date.get(5..7)?)?, two(date.get(8..10)?)?);
    if &date[4..5] != "-" || &date[7..8] != "-" || !year.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let year: i16 = year.parse().ok()?;
    // Recent history only: there the two time zone sources agree.
    if !(1970..=2099).contains(&year) {
        return None;
    }
    let (clock, rest) = time.split_at(9);
    if &clock[0..1] != "T" || &clock[3..4] != ":" || &clock[6..7] != ":" {
        return None;
    }
    let (hour, minute, second) = (two(&clock[1..3])?, two(&clock[4..6])?, two(&clock[7..9])?);
    if hour > 23 || minute > 59 || second > 59 {
        return None;
    }
    // A fraction never changes the minute shown, so its digits are only checked.
    let zone = match rest.strip_prefix('.') {
        Some(fraction) => {
            let digits = fraction.bytes().take_while(u8::is_ascii_digit).count();
            if digits == 0 {
                return None;
            }
            &fraction[digits..]
        }
        None => rest,
    };
    let offset = if zone == "Z" {
        0
    } else {
        let sign = match zone.get(0..1)? {
            "+" => 1,
            "-" => -1,
            _ => return None,
        };
        if zone.len() != 6 || &zone[3..4] != ":" {
            return None;
        }
        let (hours, minutes) = (two(&zone[1..3])?, two(&zone[4..6])?);
        if hours > 23 || minutes > 59 {
            return None;
        }
        sign * (hours as i32 * 3600 + minutes as i32 * 60)
    };
    let civil = Date::new(year, month, day).ok()?.at(hour, minute, second, 0);
    Some(Offset::from_seconds(offset).ok()?.to_timestamp(civil).ok()?.as_second())
}

/// ISO 8601 → "YYYY-MM-DD HH:MM" in local time. A message without a
/// `createTime` shows as `undefined`, as in the TypeScript.
fn format_time(create_time: Option<&Json>) -> Result<String, Fail> {
    let iso = match create_time {
        None => return Ok("undefined".to_string()),
        Some(Json::Str(iso)) => iso,
        Some(_) => return unsupported("a message whose createTime is not a string"),
    };
    let Some(second) = parse_timestamp(iso) else {
        return unsupported(format!("a createTime in a notation Rust does not read: {iso}"));
    };
    let timestamp = jiff::Timestamp::from_second(second).or_else(|e| unsupported(e.to_string()))?;
    let local = local_zone()?.to_datetime(timestamp);
    Ok(format!("{}-{:02}-{:02} {:02}:{:02}", local.year(), local.month(), local.day(), local.hour(), local.minute()))
}

/// "spaces/X/threads/ABC" | "spaces/X/messages/ABC.DEF" → "ABC" (the thread id).
pub fn thread_id_of(m: &Json) -> Result<String, TypeError> {
    let after_slash = |text: &str| text[text.rfind('/').map_or(0, |at| at + 1)..].to_string();
    let not_a_string = |what: &str| {
        TypeError(format!("{what}.lastIndexOf is not a function. (In '{what}.lastIndexOf(\"/\")', '{what}.lastIndexOf' is undefined)"))
    };
    let thread = m.prop("thread").map_err(|_| TypeError("null is not an object (evaluating 'm.thread')".to_string()))?;
    // `m.thread?.name`
    let thread_name = match thread {
        None | Some(Json::Null) => None,
        Some(thread) => thread.prop("name").ok().flatten(),
    };
    match thread_name {
        Some(Json::Str(name)) if !name.is_empty() => return Ok(after_slash(name)),
        Some(other) if other.truthy() => return Err(not_a_string("t")),
        _ => {}
    }
    // Fall back to the message-id prefix (Chat uses <threadId>.<msgId>).
    let message_id = match m.prop("name").ok().flatten() {
        Some(Json::Str(name)) => after_slash(name),
        None => return Err(TypeError("undefined is not an object (evaluating 'm.name.slice')".to_string())),
        Some(Json::Null) => return Err(TypeError("null is not an object (evaluating 'm.name.slice')".to_string())),
        Some(_) => return Err(not_a_string("m.name")),
    };
    Ok(match message_id.find('.') {
        Some(dot) => message_id[..dot].to_string(),
        None => message_id,
    })
}

/// "users/114836537158851875650" → "user:…875650" (short, stable, readable).
fn short_sender(m: &Json) -> Result<String, Fail> {
    // `m.sender?.displayName || m.sender?.name || "unknown"`
    let sender = m.prop_nullish("sender")?;
    let field = |key: &str| -> Result<Option<&str>, Fail> {
        match sender.map(|s| s.prop(key)).transpose()?.flatten().filter(|v| v.truthy()) {
            None => Ok(None),
            Some(Json::Str(text)) => Ok(Some(text)),
            Some(_) => unsupported(format!("a sender whose {key} is not a string")),
        }
    };
    let raw = match field("displayName")? {
        Some(display_name) => display_name,
        None => field("name")?.unwrap_or("unknown"),
    };
    match raw.strip_prefix("users/") {
        Some(id) => {
            let tail = if js_len(id) > 6 { js_suffix(id, 6) } else { id.to_string() };
            let is_bot = sender.map(|s| s.prop("type")).transpose()?.flatten().and_then(Json::as_str) == Some("BOT");
            Ok(format!("{}:…{tail}", if is_bot { "bot" } else { "user" }))
        }
        None => Ok(raw.to_string()),
    }
}

/// `text.replace(/\s*\n\s*/g, " ⏎ ").trim()`: every run of whitespace that
/// holds a line feed becomes one marker.
fn one_line(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut run = String::new();
    let flush = |out: &mut String, run: &mut String| {
        if run.contains('\n') {
            out.push_str(" ⏎ ");
        } else {
            out.push_str(run);
        }
        run.clear();
    };
    for c in text.chars() {
        if is_js_whitespace(c) {
            run.push(c);
        } else {
            flush(&mut out, &mut run);
            out.push(c);
        }
    }
    flush(&mut out, &mut run);
    crate::json::js_trim(&out).to_string()
}

/// Renders one message. `space_id` (short) is included in the thread hint so
/// the user can copy "<spaceId>:<threadId>" straight into `gchat send`.
pub fn format_message(m: &Json, space_id: &str) -> Result<String, Fail> {
    let time = format_time(m.prop("createTime")?)?;
    let who = short_sender(m)?;
    // `m.text ?? m.formattedText ?? m.argumentText ?? "(no text)"`
    let mut body = "(no text)";
    for key in ["text", "formattedText", "argumentText"] {
        match m.prop_nullish(key)? {
            None => continue,
            Some(Json::Str(text)) => {
                body = text;
                break;
            }
            Some(_) => return unsupported(format!("a message whose {key} is not a string")),
        }
    }
    let thread = thread_id_of(m)?;
    Ok(format!("[{time}] {who}: {} [thread {space_id}:{thread}]", one_line(body)))
}

pub fn format_spaces_table(spaces: &[Json]) -> Result<String, Fail> {
    struct Row {
        id: String,
        kind: String,
        name: String,
    }
    let mut rows = Vec::with_capacity(spaces.len());
    for space in spaces {
        let field = |key: &str| -> Result<Option<&str>, Fail> {
            match space.prop_nullish(key)? {
                None => Ok(None),
                Some(Json::Str(text)) => Ok(Some(text)),
                Some(_) => unsupported(format!("a space whose {key} is not a string")),
            }
        };
        let Some(name) = field("name")? else { return unsupported("a space without a name") };
        rows.push(Row {
            id: space_id(name).to_string(),
            kind: field("spaceType")?.unwrap_or("").replacen("DIRECT_MESSAGE", "DM", 1).replacen("SPACE", "room", 1),
            name: field("displayName")?.unwrap_or("(direct message)").to_string(),
        });
    }
    let id_width = rows.iter().map(|r| js_len(&r.id)).fold(2, usize::max);
    let kind_width = rows.iter().map(|r| js_len(&r.kind)).fold(4, usize::max);
    let pad = |text: &str, width: usize| format!("{text}{}", " ".repeat(width.saturating_sub(js_len(text))));
    let mut lines = vec![
        format!("{}  {}  name", pad("id", id_width), pad("type", kind_width)),
        format!("{}  {}  ----", "-".repeat(id_width), "-".repeat(kind_width)),
    ];
    lines.extend(rows.iter().map(|r| format!("{}  {}  {}", pad(&r.id, id_width), pad(&r.kind, kind_width), r.name)));
    Ok(lines.join("\n"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn one_line_marks_line_breaks() {
        assert_eq!(one_line("a\nb"), "a ⏎ b");
        assert_eq!(one_line("  a \n\n \t b  c\r\n"), "a ⏎ b  c ⏎");
        assert_eq!(one_line("a\u{2028}b \u{a0} c"), "a\u{2028}b \u{a0} c");
        assert_eq!(one_line("\n"), "⏎");
    }

    #[test]
    fn reads_only_googles_notation() {
        assert_eq!(parse_timestamp("2026-07-07T07:41:50Z"), Some(1783410110));
        assert_eq!(parse_timestamp("2026-07-07T07:41:59.999999999Z"), Some(1783410119));
        assert_eq!(parse_timestamp("2026-07-07T07:41:50+09:00"), Some(1783377710));
        assert_eq!(parse_timestamp("2026-07-07T07:41:50.5-03:30"), Some(1783422710));
        for other in [
            "2026-07-07T07:41Z",
            "2026-07-07T07:41:50",
            "2026-07-07",
            "2026-02-30T00:00:00Z",
            "2026-07-07T24:00:00Z",
            "2026-07-07t07:41:50z",
            "2026-07-07 07:41:50Z",
            "2026-07-07T07:41:50.Z",
            "2026-07-07T07:41:50+0900",
            "0001-01-01T00:00:00Z",
            "2026-07-07T07:41:50Z ",
            "",
        ] {
            assert_eq!(parse_timestamp(other), None, "{other}");
        }
    }
}
