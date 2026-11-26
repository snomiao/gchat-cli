//! `gchat spaces` — list spaces, newest activity first. Port of
//! ts/commands/spaces.ts.

use crate::args::{self, Kind, Opt, Spec};
use crate::config::write_spaces_cache;
use crate::format::format_spaces_table;
use crate::gws::list_spaces;
use crate::json::Json;
use crate::resolver::cache_entry;
use crate::rt::{out, unsupported, Fail};

const SPEC: Spec = Spec { options: &[Opt { long: "format", short: None, kind: Kind::Choice(&["table", "json"]) }], flags: &[] };

pub fn command(rest: &[String]) -> Option<impl FnOnce() -> Result<i32, Fail>> {
    let parsed = args::parse(rest, &SPEC)?;
    if !parsed.positionals.is_empty() {
        return None;
    }
    let json = parsed.value("format") == Some("json");
    Some(move || run(json))
}

/// `YYYY-MM-DDTHH:MM:SS[.digits]Z`, the only notation Google uses here.
fn is_zulu_timestamp(text: &str) -> bool {
    let bytes = text.as_bytes();
    let shape = b"dddd-dd-ddTdd:dd:dd";
    if bytes.len() < shape.len() + 1 || bytes[bytes.len() - 1] != b'Z' {
        return false;
    }
    let fixed = shape.iter().zip(bytes).all(|(want, have)| if *want == b'd' { have.is_ascii_digit() } else { want == have });
    let fraction = &bytes[shape.len()..bytes.len() - 1];
    fixed && (fraction.is_empty() || (fraction.len() > 1 && fraction[0] == b'.' && fraction[1..].iter().all(u8::is_ascii_digit)))
}

/// The sort key: `s.lastActiveTime ?? ""`.
///
/// The TypeScript orders these with `localeCompare`, the user's locale and
/// all. For timestamps in Google's notation that order is plain character
/// order, which is what Rust uses; any other value is not sorted here.
fn activity(space: &Json) -> Result<&str, Fail> {
    match space.prop_nullish("lastActiveTime")? {
        None => Ok(""),
        Some(Json::Str(time)) if is_zulu_timestamp(time) => Ok(time),
        Some(_) => unsupported("a lastActiveTime that is not a UTC timestamp"),
    }
}

fn run(json: bool) -> Result<i32, Fail> {
    let mut spaces = list_spaces()?;
    for space in &spaces {
        activity(space)?;
    }
    // Stable, like Array.prototype.sort.
    spaces.sort_by(|a, b| activity(b).unwrap_or("").cmp(activity(a).unwrap_or("")));

    // Every `spaces` call refreshes the resolver cache — it just paid for the data.
    let entries = spaces.iter().map(cache_entry).collect::<Result<Vec<_>, _>>()?;
    let text = if json { Json::Arr(spaces).pretty() } else { format_spaces_table(&spaces)? };
    write_spaces_cache(entries)?;
    out(&text);
    Ok(0)
}

#[cfg(test)]
mod tests {
    use super::is_zulu_timestamp;

    #[test]
    fn only_googles_notation_is_sorted_here() {
        for ok in ["2026-07-07T07:41:50Z", "2026-07-07T07:41:50.5Z", "2026-07-07T07:41:50.123456789Z"] {
            assert!(is_zulu_timestamp(ok), "{ok}");
        }
        for other in ["", "2026-07-07T07:41:50", "2026-07-07T07:41:50.Z", "2026-07-07T07:41:50+09:00", "2026-07-07 07:41:50Z", "2026-07-07T07:41:50.5z", "07/08/2026", "2026-07-07T07:41:50.1.2Z"] {
            assert!(!is_zulu_timestamp(other), "{other}");
        }
    }
}
