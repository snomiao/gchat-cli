//! Recognizes the command lines Rust runs itself.
//!
//! The TypeScript parses its arguments with yargs, which accepts far more
//! spellings than anyone types (`--no-flag`, `-n5`, `--limit=0x10`, options
//! given twice that turn into lists) and answers mistakes with its own,
//! localized text. This is not a second yargs. It accepts the plain spellings
//! whose meaning is not in doubt and returns `None` for everything else, and
//! the caller then hands the invocation back to the JavaScript untouched.

pub enum Kind {
    /// One of a fixed set of words.
    Choice(&'static [&'static str]),
    /// A whole number, written plainly: `0`, `25`, `-3`.
    Int,
    /// A non-negative decimal number, written plainly: `20`, `0.5`.
    Decimal,
    /// Any text.
    Text,
}

pub struct Opt {
    pub long: &'static str,
    pub short: Option<&'static str>,
    pub kind: Kind,
}

pub struct Spec {
    /// Options that take a value.
    pub options: &'static [Opt],
    /// Options that are on when present.
    pub flags: &'static [&'static str],
}

pub struct Parsed {
    pub positionals: Vec<String>,
    values: Vec<(&'static str, String)>,
    flags: Vec<&'static str>,
}

impl Parsed {
    pub fn value(&self, long: &str) -> Option<&str> {
        self.values.iter().find(|(name, _)| *name == long).map(|(_, value)| value.as_str())
    }

    pub fn flag(&self, long: &str) -> bool {
        self.flags.contains(&long)
    }
}

fn is_int(text: &str, allow_negative: bool) -> bool {
    let digits = match text.strip_prefix('-') {
        // No "-0": it is its own value in JavaScript.
        Some(digits) if allow_negative && digits != "0" => digits,
        Some(_) => return false,
        None => text,
    };
    (1..=9).contains(&digits.len()) && digits.bytes().all(|b| b.is_ascii_digit()) && (digits == "0" || !digits.starts_with('0'))
}

fn is_decimal(text: &str) -> bool {
    let (whole, fraction) = match text.split_once('.') {
        Some((whole, fraction)) => (whole, Some(fraction)),
        None => (text, None),
    };
    (1..=7).contains(&whole.len())
        && is_int(whole, false)
        && fraction.is_none_or(|f| (1..=6).contains(&f.len()) && f.bytes().all(|b| b.is_ascii_digit()))
}

fn fits(kind: &Kind, value: &str) -> bool {
    match kind {
        Kind::Choice(words) => words.contains(&value),
        Kind::Int => is_int(value, true),
        Kind::Decimal => is_decimal(value),
        Kind::Text => true,
    }
}

/// The arguments after the command name, if they are in the plain form.
pub fn parse(rest: &[String], spec: &Spec) -> Option<Parsed> {
    let mut parsed = Parsed { positionals: Vec::new(), values: Vec::new(), flags: Vec::new() };
    let mut i = 0;
    while i < rest.len() {
        let token = rest[i].as_str();
        i += 1;
        if token.is_empty() {
            return None;
        }
        if !token.starts_with('-') {
            parsed.positionals.push(token.to_string());
            continue;
        }
        // `--name=value`, `--name value`, `-n value`, or `--flag`.
        let (option, inline) = if let Some(long) = token.strip_prefix("--") {
            let (name, inline) = match long.split_once('=') {
                Some((name, value)) => (name, Some(value)),
                None => (long, None),
            };
            if inline.is_none() && spec.flags.contains(&name) {
                let flag = *spec.flags.iter().find(|f| **f == name)?;
                // yargs reads a following `true`/`false` as the flag's value.
                if parsed.flags.contains(&flag) || matches!(rest.get(i).map(String::as_str), Some("true" | "false")) {
                    return None;
                }
                parsed.flags.push(flag);
                continue;
            }
            (spec.options.iter().find(|o| o.long == name)?, inline)
        } else {
            (spec.options.iter().find(|o| o.short == Some(&token[1..]))?, None)
        };
        let value = match inline {
            // yargs strips a pair of quotes from an inline value.
            Some(value) if value.starts_with(['"', '\'']) => return None,
            Some(value) => value,
            None => {
                let value = rest.get(i)?.as_str();
                i += 1;
                // A value that starts with a dash is an option to yargs,
                // unless it is a negative number.
                if value.starts_with('-') && !matches!(option.kind, Kind::Int) {
                    return None;
                }
                value
            }
        };
        if value.is_empty() || !fits(&option.kind, value) || parsed.value(option.long).is_some() {
            return None;
        }
        parsed.values.push((option.long, value.to_string()));
    }
    Some(parsed)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SPEC: Spec = Spec {
        options: &[
            Opt { long: "limit", short: Some("n"), kind: Kind::Int },
            Opt { long: "interval", short: None, kind: Kind::Decimal },
            Opt { long: "format", short: None, kind: Kind::Choice(&["text", "json"]) },
            Opt { long: "code", short: None, kind: Kind::Text },
        ],
        flags: &["dry-run"],
    };

    fn parse_words(words: &[&str]) -> Option<Parsed> {
        parse(&words.iter().map(|w| w.to_string()).collect::<Vec<_>>(), &SPEC)
    }

    #[test]
    fn takes_the_plain_spellings() {
        let p = parse_words(&["eng", "-n", "5", "--format=json", "--dry-run", "hello world", "--code", "1e5"]).unwrap();
        assert_eq!(p.positionals, ["eng", "hello world"]);
        assert_eq!(p.value("limit"), Some("5"));
        assert_eq!(p.value("format"), Some("json"));
        assert_eq!(p.value("code"), Some("1e5"));
        assert!(p.flag("dry-run"));
        assert_eq!(parse_words(&["--limit", "-3"]).unwrap().value("limit"), Some("-3"));
        assert_eq!(parse_words(&["--interval=0.25"]).unwrap().value("interval"), Some("0.25"));
    }

    #[test]
    fn leaves_everything_else_to_yargs() {
        for words in [
            &["--help"][..],
            &["-h"],
            &["--version"],
            &["--unknown"],
            &["-n5"],
            &["-n=5"],
            &["--limit", "abc"],
            &["--limit", "1e3"],
            &["--limit", "05"],
            &["--limit", "-0"],
            &["--limit", "1.5"],
            &["--limit"],
            &["--limit=5", "-n", "6"],
            &["--format", "yaml"],
            &["--format=\"json\""],
            &["--interval", "-1"],
            &["--interval", ".5"],
            &["--code", "-x"],
            &["--code="],
            &["--dry-run", "true"],
            &["--dry-run=true"],
            &["--no-dry-run"],
            &["--dryRun"],
            &["--dry-run", "--dry-run"],
            &["--"],
            &["-"],
            &[""],
            &["-x"],
        ] {
            assert!(parse_words(words).is_none(), "{words:?}");
        }
    }
}
