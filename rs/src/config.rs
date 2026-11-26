//! Where gchat keeps its two kinds of files, and the space-name cache.
//! Port of ts/config.ts, plus `os.homedir()`, `os.tmpdir()` and `path.join`
//! as the TypeScript gets them from the JavaScript runtime.

use std::fs;
use std::path::Path;

use crate::json::{self, object, Json, ParseError};
use crate::rt::{unsupported, Fail};

/// `path.join(...parts)` on POSIX: joined with `/`, then normalized without
/// looking at the file system (`a/b/../c` is `a/c` even if `b` is a link).
#[cfg(not(windows))]
fn join(parts: &[&str]) -> String {
    let joined: Vec<&str> = parts.iter().copied().filter(|p| !p.is_empty()).collect();
    let joined = joined.join("/");
    if joined.is_empty() {
        return ".".to_string();
    }
    let absolute = joined.starts_with('/');
    let trailing = joined.ends_with('/');
    let mut kept: Vec<&str> = Vec::new();
    for segment in joined.split('/') {
        match segment {
            "" | "." => {}
            ".." => match kept.last() {
                Some(last) if *last != ".." => {
                    kept.pop();
                }
                _ if !absolute => kept.push(".."),
                _ => {}
            },
            segment => kept.push(segment),
        }
    }
    let mut path = kept.join("/");
    if path.is_empty() {
        return if absolute { "/" } else if trailing { "./" } else { "." }.to_string();
    }
    if trailing {
        path.push('/');
    }
    if absolute {
        format!("/{path}")
    } else {
        path
    }
}

/// On Windows the system resolves `..` and mixed separators itself, so the
/// parts only need to be put together.
#[cfg(windows)]
fn join(parts: &[&str]) -> String {
    let mut path = std::path::PathBuf::new();
    for part in parts {
        path.push(part);
    }
    path.to_string_lossy().into_owned()
}

fn env(name: &str) -> Result<Option<String>, Fail> {
    match std::env::var_os(name) {
        None => Ok(None),
        Some(value) if value.is_empty() => Ok(None),
        Some(value) => value.into_string().map(Some).or_else(|_| unsupported(format!("{name} is not valid Unicode"))),
    }
}

/// `os.homedir()` when the environment names it. Without the variable the
/// runtime asks the system instead; that case is left to the JavaScript.
fn home_dir() -> Result<String, Fail> {
    let name = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
    match env(name)? {
        Some(home) => Ok(home),
        None => unsupported(format!("{name} is not set")),
    }
}

/// `os.tmpdir()`.
fn tmp_dir() -> Result<String, Fail> {
    #[cfg(not(windows))]
    {
        let mut dir = match (env("TMPDIR")?, env("TMP")?, env("TEMP")?) {
            (Some(dir), _, _) | (None, Some(dir), _) | (None, None, Some(dir)) => dir,
            (None, None, None) => "/tmp".to_string(),
        };
        if dir.len() > 1 && dir.ends_with('/') {
            dir.pop();
        }
        Ok(dir)
    }
    #[cfg(windows)]
    {
        let mut dir = match (env("TEMP")?, env("TMP")?) {
            (Some(dir), _) | (None, Some(dir)) => dir,
            (None, None) => match (env("SystemRoot")?, env("windir")?) {
                (Some(root), _) | (None, Some(root)) => format!("{root}\\temp"),
                (None, None) => return unsupported("no TEMP directory in the environment"),
            },
        };
        if dir.len() > 1 && dir.ends_with('\\') && !dir.ends_with(":\\") {
            dir.pop();
        }
        Ok(dir)
    }
}

/// ~/.config/gchat-cli
fn config_dir() -> Result<String, Fail> {
    Ok(join(&[&home_dir()?, ".config", "gchat-cli"]))
}

fn spaces_cache_path() -> Result<String, Fail> {
    Ok(join(&[&config_dir()?, "spaces.json"]))
}

/// Where a pending send with this confirm code is kept.
pub fn pending_path(hash: &str) -> Result<String, Fail> {
    Ok(join(&[&tmp_dir()?, &format!("gchat-cli-pending-{hash}.json")]))
}

/// `Date.now()`.
pub fn now_ms() -> f64 {
    match std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH) {
        Ok(since) => since.as_millis() as f64,
        Err(before) => -(before.duration().as_millis() as f64),
    }
}

/// `existsSync(path)`.
pub fn exists(path: &str) -> bool {
    fs::metadata(path).is_ok()
}

/// A file error after which the invocation is handed back: the text the
/// TypeScript prints for it is the JavaScript runtime's.
pub fn fs_failure(action: &str, path: &str, error: &std::io::Error) -> Fail {
    Fail::Unsupported(format!("cannot {action} {path}: {error}"))
}

/// `JSON.parse(readFileSync(path, "utf8"))`: `None` where either one throws.
pub fn read_json(path: &str) -> Result<Option<Json>, Fail> {
    let Ok(bytes) = fs::read(path) else { return Ok(None) };
    match json::parse(&String::from_utf8_lossy(&bytes), false) {
        Ok(value) => Ok(Some(value)),
        Err(ParseError::Syntax) => Ok(None),
        Err(ParseError::Unsupported(why)) => unsupported(format!("{path}: {why}")),
    }
}

/// The cached space list, or `None` if there is no readable cache.
pub fn read_spaces_cache() -> Result<Option<Json>, Fail> {
    let path = spaces_cache_path()?;
    if !exists(&path) {
        return Ok(None);
    }
    read_json(&path)
}

/// Writes the cache: `{ fetched_at, spaces: [{ name, displayName, type }] }`.
pub fn write_spaces_cache(entries: Vec<Json>) -> Result<(), Fail> {
    let dir = config_dir()?;
    let path = spaces_cache_path()?;
    let cache = object([("fetched_at", Json::Num(now_ms())), ("spaces", Json::Arr(entries))]);
    if !exists(&dir) {
        let mut builder = fs::DirBuilder::new();
        builder.recursive(true);
        #[cfg(unix)]
        std::os::unix::fs::DirBuilderExt::mode(&mut builder, 0o700);
        builder.create(Path::new(&dir)).map_err(|e| fs_failure("create", &dir, &e))?;
    }
    fs::write(&path, cache.pretty() + "\n").map_err(|e| fs_failure("write", &path, &e))
}

#[cfg(all(test, not(windows)))]
mod tests {
    use super::join;

    #[test]
    fn joins_like_node() {
        assert_eq!(join(&["/x/y/", ".config", "gchat-cli"]), "/x/y/.config/gchat-cli");
        assert_eq!(join(&["rel", ".config", "gchat-cli"]), "rel/.config/gchat-cli");
        assert_eq!(join(&["./r//s/../", ".config", "gchat-cli"]), "r/.config/gchat-cli");
        assert_eq!(join(&["../..", "a", "..", "..", "b"]), "../../../b");
        assert_eq!(join(&["/..", "a"]), "/a");
        assert_eq!(join(&["/", "x.json"]), "/x.json");
        assert_eq!(join(&["tmp", "x.json"]), "tmp/x.json");
        assert_eq!(join(&[".", "."]), ".");
        assert_eq!(join(&["a/", ""]), "a/");
    }
}
