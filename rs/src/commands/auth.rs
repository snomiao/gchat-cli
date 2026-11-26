//! `gchat auth` — show whether gws is authorized with the Chat scopes gchat
//! needs. Port of ts/commands/auth.ts.

use crate::args::{self, Kind, Opt, Spec};
use crate::gws::auth_status;
use crate::json::Json;
use crate::rt::{out, unsupported, Fail};

const NEEDED: [(&str, &str); 3] = [
    ("https://www.googleapis.com/auth/chat.spaces.readonly", "gchat spaces"),
    ("https://www.googleapis.com/auth/chat.messages.readonly", "gchat read / tail / watch"),
    ("https://www.googleapis.com/auth/chat.messages.create", "gchat send"),
];

const SPEC: Spec = Spec { options: &[Opt { long: "format", short: None, kind: Kind::Choice(&["text", "json"]) }], flags: &[] };

/// The command for these arguments, or `None` if they are not in a form Rust
/// takes on.
pub fn command(rest: &[String]) -> Option<impl FnOnce() -> Result<i32, Fail>> {
    let parsed = args::parse(rest, &SPEC)?;
    if !parsed.positionals.is_empty() {
        return None;
    }
    let json = parsed.value("format") == Some("json");
    Some(move || run(json))
}

/// `new Set(values).size`: equal strings, numbers, booleans and nulls count
/// once; every list and object is its own value.
fn distinct(values: &[Json]) -> usize {
    let mut seen: Vec<&Json> = Vec::new();
    let mut count = 0;
    for value in values {
        match value {
            Json::Arr(_) | Json::Obj(_) => count += 1,
            // PartialEq on f64 already treats 0 and -0 as equal.
            primitive if !seen.contains(&primitive) => {
                seen.push(primitive);
                count += 1;
            }
            _ => {}
        }
    }
    count
}

fn run(json: bool) -> Result<i32, Fail> {
    let status = auth_status()?;
    if json {
        out(&status.pretty());
        return Ok(0);
    }
    // `new Set(status.scopes ?? [])`
    let scopes: &[Json] = match status.prop_nullish("scopes")? {
        None => &[],
        Some(Json::Arr(scopes)) => scopes,
        Some(_) => return unsupported("gws returned `scopes` that is not a list"),
    };
    let method = status.prop_nullish("auth_method")?.map_or("unknown".to_string(), Json::to_js_string);
    let count = status.prop_nullish("scope_count")?.map_or(distinct(scopes).to_string(), Json::to_js_string);

    let mut lines = vec![format!("auth method: {method}  (scopes: {count})"), "--- Chat scopes --------------------------------".to_string()];
    let mut missing = false;
    for (scope, purpose) in NEEDED {
        let granted = scopes.iter().any(|s| s.as_str() == Some(scope));
        missing |= !granted;
        let short = scope.replacen("https://www.googleapis.com/auth/", "", 1);
        lines.push(format!("  {} {short}  — {purpose}", if granted { "✓" } else { "✗" }));
    }
    if missing {
        lines.push("------------------------------------------------".to_string());
        lines.push("Some scopes are missing. Re-authorize gws to grant them (see gws docs).".to_string());
    }
    out(&lines.join("\n"));
    Ok(if missing { 1 } else { 0 })
}
