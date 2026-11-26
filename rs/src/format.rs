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
use crate::rt::{not_a_function, null_access, unsupported, Fail};

/// What JavaScript throws when a value has the wrong type, with the text bun
/// prints for it. Only `gchat send` shows one: after a message was posted
/// there is no handing back.
pub struct TypeError(pub String);

impl From<TypeError> for Fail {
    fn from(error: TypeError) -> Self {
        Fail::Unsupported(error.0)
    }
}

/// A zone by name. The database compiled into the binary is asked first, as
/// the JavaScript runtime also carries its own (ICU's): the answer then does
/// not depend on which zone files a machine has installed.
fn zone(name: &str) -> Option<TimeZone> {
    jiff::tz::TimeZoneDatabase::bundled().get(name).or_else(|_| TimeZone::get(name)).ok()
}

/// The time zone `Date` uses for local time: the one named in `TZ`, else the
/// system's. `TZ` can also hold a rule or a path, which the JavaScript
/// runtime reads its own way; those are not taken on.
fn local_zone() -> Result<TimeZone, Fail> {
    match std::env::var_os("TZ") {
        Some(tz) => match tz.to_str().filter(|name| !name.is_empty()).and_then(zone) {
            Some(zone) => Ok(zone),
            None => unsupported(format!("TZ={} is not the name of a time zone", tz.to_string_lossy())),
        },
        None => match TimeZone::try_system() {
            Ok(system) => Ok(system.iana_name().and_then(zone).unwrap_or(system)),
            Err(error) => unsupported(format!("no system time zone: {error}")),
        },
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

fn local_minute(second: i64, zone: &TimeZone) -> Option<String> {
    let local = zone.to_datetime(jiff::Timestamp::from_second(second).ok()?);
    Some(format!("{}-{:02}-{:02} {:02}:{:02}", local.year(), local.month(), local.day(), local.hour(), local.minute()))
}

/// ISO 8601 → "YYYY-MM-DD HH:MM" in local time. A message without a
/// `createTime` shows as `undefined`, as in the TypeScript.
///
/// `lenient` is for a tail that is already running, where there is no handing
/// back: a time Rust does not read is then shown as it came (which is also
/// what the TypeScript shows for a time JavaScript cannot read).
fn format_time(create_time: Option<&Json>, lenient: bool) -> Result<String, Fail> {
    let zone = match local_zone() {
        Ok(zone) => zone,
        Err(_) if lenient => TimeZone::system(),
        Err(unsupported) => return Err(unsupported),
    };
    let known = match create_time {
        None => return Ok("undefined".to_string()),
        Some(Json::Str(iso)) => parse_timestamp(iso).and_then(|second| local_minute(second, &zone)),
        // `new Date(null)` is the epoch, `new Date(number)` that many milliseconds.
        Some(Json::Null) if lenient => local_minute(0, &zone),
        Some(Json::Num(ms)) if lenient && ms.is_finite() => local_minute((ms / 1000.0).floor() as i64, &zone),
        Some(_) => None,
    };
    match (known, create_time) {
        (Some(text), _) => Ok(text),
        (None, Some(shown)) if lenient => Ok(shown.to_js_string()),
        (None, Some(Json::Str(iso))) => unsupported(format!("a createTime in a notation Rust does not read: {iso}")),
        (None, _) => unsupported("a message whose createTime is not a string"),
    }
}

/// "spaces/X/threads/ABC" | "spaces/X/messages/ABC.DEF" → "ABC" (the thread id).
///
/// Written for strings. The other outcomes are what the same JavaScript does
/// to other values: most throw, and a list has `slice` and `lastIndexOf` of
/// its own.
pub fn thread_id_of(m: &Json) -> Result<String, TypeError> {
    // `value.slice(value.lastIndexOf("/") + 1)`
    fn after_slash(value: &Json, what: &str) -> Result<Json, TypeError> {
        match value {
            Json::Str(text) => Ok(Json::Str(text[text.rfind('/').map_or(0, |at| at + 1)..].to_string())),
            Json::Arr(items) => {
                let from = items.iter().rposition(|item| item.as_str() == Some("/")).map_or(0, |at| at + 1);
                Ok(Json::Arr(items[from..].to_vec()))
            }
            _ => Err(TypeError(format!(
                "{what}.lastIndexOf is not a function. (In '{what}.lastIndexOf(\"/\")', '{what}.lastIndexOf' is undefined)"
            ))),
        }
    }
    let thread = m.prop("thread").map_err(|_| TypeError("null is not an object (evaluating 'm.thread')".to_string()))?;
    // `m.thread?.name`
    let thread_name = match thread {
        None | Some(Json::Null) => None,
        Some(thread) => thread.prop("name").ok().flatten(),
    };
    if let Some(name) = thread_name.filter(|name| name.truthy()) {
        return Ok(after_slash(name, "t")?.to_js_string());
    }
    // Fall back to the message-id prefix (Chat uses <threadId>.<msgId>).
    let message_id = match m.prop("name").ok().flatten() {
        None => return Err(TypeError("undefined is not an object (evaluating 'm.name.slice')".to_string())),
        Some(Json::Null) => return Err(TypeError("null is not an object (evaluating 'm.name.slice')".to_string())),
        Some(name) => after_slash(name, "m.name")?,
    };
    // `dot === -1 ? msgId : msgId.slice(0, dot)`
    Ok(match &message_id {
        Json::Str(id) => id.find('.').map_or(id.as_str(), |dot| &id[..dot]).to_string(),
        Json::Arr(items) => {
            let dot = items.iter().position(|item| item.as_str() == Some(".")).unwrap_or(items.len());
            Json::Arr(items[..dot].to_vec()).to_js_string()
        }
        other => other.to_js_string(),
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
            Some(_) => Err(not_a_function("raw.startsWith", "raw.startsWith(\"users/\")")),
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
pub fn format_message(m: &Json, space_id: &str, lenient: bool) -> Result<String, Fail> {
    let time = format_time(m.prop("createTime").map_err(|_| null_access("m.createTime"))?, lenient)?;
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
            // bun words this one differently (the call holds a non-ASCII character).
            Some(_) => return unsupported("undefined is not a function (near '...text.replace(/\\s*\\n\\s*/g, \" \\u23CE \")...')"),
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
