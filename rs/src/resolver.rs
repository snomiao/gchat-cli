//! Turns a `<space>` argument into a space name ("spaces/<id>"), and splits
//! the "<space>:<threadId>" reply syntax. Port of ts/space-resolver.ts.

use crate::config::{now_ms, read_spaces_cache, write_spaces_cache};
use crate::gws::list_spaces;
use crate::json::{object, string, Json};
use crate::rt::{unsupported, Fail};

const CACHE_TTL_MS: f64 = 5.0 * 60.0 * 1000.0;

pub struct ResolvedSpace {
    /// "spaces/<id>"
    pub name: String,
    /// "" when there is none (a direct message, or a name given as-is).
    pub display_name: String,
}

struct Entry {
    name: String,
    display_name: String,
}

/// Splits "<space>:<threadId>" at the last colon. A tail with a slash (a URL)
/// or an empty tail is not a thread id.
pub fn split_thread(arg: &str) -> (&str, Option<&str>) {
    match arg.rfind(':') {
        Some(at) if !arg[at + 1..].is_empty() && !arg[at + 1..].contains('/') => (&arg[..at], Some(&arg[at + 1..])),
        _ => (arg, None),
    }
}

/// The part of a space name after "spaces/" (`name.replace(/^spaces\//, "")`).
pub fn space_id(name: &str) -> &str {
    name.strip_prefix("spaces/").unwrap_or(name)
}

pub fn resolve_space(arg: &str) -> Result<ResolvedSpace, Fail> {
    if arg.starts_with("spaces/") {
        return Ok(ResolvedSpace { name: arg.to_string(), display_name: String::new() });
    }
    let spaces = load_spaces_cached()?;

    // Bare space id (matches the tail of a resource name).
    let wanted = format!("spaces/{arg}");
    if let Some(by_id) = spaces.iter().find(|s| s.name == wanted) {
        return Ok(resolved(by_id));
    }

    let named: Vec<&Entry> = spaces.iter().filter(|s| !s.display_name.is_empty()).collect();
    let exact: Vec<&Entry> = named.iter().copied().filter(|s| s.display_name == arg).collect();
    match exact.len() {
        0 => {}
        1 => return Ok(resolved(exact[0])),
        _ => return Err(ambiguous(arg, &exact)),
    }

    let fuzzy: Vec<&Entry> = named.iter().copied().filter(|s| s.display_name.contains(arg)).collect();
    match fuzzy.len() {
        0 => Err(Fail::Error(format!("No space matching \"{arg}\". Try: gchat spaces"))),
        1 => Ok(resolved(fuzzy[0])),
        _ => Err(ambiguous(arg, &fuzzy)),
    }
}

fn resolved(entry: &Entry) -> ResolvedSpace {
    ResolvedSpace { name: entry.name.clone(), display_name: entry.display_name.clone() }
}

fn ambiguous(arg: &str, matches: &[&Entry]) -> Fail {
    let list: Vec<String> = matches.iter().take(6).map(|s| format!("{}={}", s.name, s.display_name)).collect();
    Fail::Error(format!(
        "Ambiguous \"{arg}\" — matches {} spaces: {}. Use the space id instead.",
        matches.len(),
        list.join(", ")
    ))
}

/// A space as the resolver needs it. Anything but strings where the
/// TypeScript expects strings is left to the JavaScript.
fn entry(space: &Json) -> Result<Entry, Fail> {
    let (Json::Obj(_), Ok(Some(Json::Str(name)))) = (space, space.prop("name")) else {
        return unsupported("a space without a name");
    };
    let display_name = match space.prop_nullish("displayName")? {
        None => String::new(),
        Some(Json::Str(display_name)) => display_name.clone(),
        Some(_) => return unsupported("a space whose displayName is not a string"),
    };
    Ok(Entry { name: name.clone(), display_name })
}

/// What `gchat spaces` and the resolver write to the cache for one space:
/// `{ name, displayName: s.displayName ?? "", type: s.spaceType ?? "SPACE" }`.
pub fn cache_entry(space: &Json) -> Result<Json, Fail> {
    let Entry { name, display_name } = entry(space)?;
    let kind = match space.prop_nullish("spaceType")? {
        None => "SPACE",
        Some(Json::Str(kind)) => kind,
        Some(_) => return unsupported("a space whose spaceType is not a string"),
    };
    Ok(object([("name", string(&name)), ("displayName", string(&display_name)), ("type", string(kind))]))
}

fn load_spaces_cached() -> Result<Vec<Entry>, Fail> {
    // `cache && Date.now() - cache.fetched_at < CACHE_TTL_MS`
    if let Some(cache) = read_spaces_cache()?.filter(Json::truthy) {
        let fresh = match cache.prop("fetched_at")? {
            Some(Json::Num(fetched_at)) => now_ms() - fetched_at < CACHE_TTL_MS,
            // undefined makes the difference NaN; null counts as 0.
            None | Some(Json::Null) => false,
            Some(_) => return unsupported("a space cache whose fetched_at is not a number"),
        };
        if fresh {
            return match cache.prop("spaces")? {
                Some(Json::Arr(spaces)) => spaces.iter().map(entry).collect(),
                _ => unsupported("a space cache without a list of spaces"),
            };
        }
    }
    let spaces = list_spaces()?;
    let entries: Vec<Entry> = spaces.iter().map(entry).collect::<Result<_, _>>()?;
    write_spaces_cache(spaces.iter().map(cache_entry).collect::<Result<_, _>>()?)?;
    Ok(entries)
}

#[cfg(test)]
mod tests {
    use super::split_thread;

    #[test]
    fn splits_at_the_last_colon() {
        assert_eq!(split_thread("Engineering"), ("Engineering", None));
        assert_eq!(split_thread("AAAAxxxx:TTTTyyyy"), ("AAAAxxxx", Some("TTTTyyyy")));
        assert_eq!(split_thread("spaces/AAAAxxxx"), ("spaces/AAAAxxxx", None));
        assert_eq!(split_thread("spaces/AAAAxxxx:TTTTyyyy"), ("spaces/AAAAxxxx", Some("TTTTyyyy")));
        assert_eq!(split_thread("https://chat.google.com/room/x"), ("https://chat.google.com/room/x", None));
        assert_eq!(split_thread("eng:"), ("eng:", None));
        assert_eq!(split_thread("a:b:c"), ("a:b", Some("c")));
    }
}
