//! gchat-cli — Rust entry point.
//!
//! Installed from npm, this binary is the command users run. A command runs
//! here once it has been ported and a parity test shows it behaves like the
//! TypeScript; until then it is handed back to the JavaScript the package
//! still ships, so nothing changes for users.

mod args;
mod commands;
mod config;
mod format;
mod gws;
mod js_fallback;
mod json;
mod resolver;
mod rt;

/// The package's JavaScript entry, relative to the package root.
///
/// `ts/cli.ts`, not the `dist/cli.js` that `publishConfig.bin` names: npm does
/// not apply `publishConfig.bin`, so the published package (checked on
/// gchat-cli@1.2.0) has `bin: { gchat: "./ts/cli.ts" }` and that file is what
/// users run today. The two also differ: the bundle has no yargs locale
/// files, so it prints usage errors and `--help` in English where `ts/cli.ts`
/// follows the user's locale.
const JS_ENTRY: &str = "ts/cli.ts";

/// `GCHAT_CLI_NO_NATIVE=1` hands every command back to the JavaScript: the way
/// out for a user if a ported command misbehaves.
fn native() -> bool {
    std::env::var_os("GCHAT_CLI_NO_NATIVE").is_none()
}

fn main() {
    // An argument that is not valid Unicode is handed back like anything else
    // Rust does not handle (`std::env::args` would panic on it).
    let args: Option<Vec<String>> = std::env::args_os().skip(1).map(|a| a.into_string().ok()).collect();
    let Some(args) = args else { js_fallback::run(JS_ENTRY) };
    // A ported command takes the invocation only when its arguments are in
    // the plain form it reproduces; `command` is `None` for anything else
    // (usage errors, --help, unusual spellings), which yargs still answers.
    macro_rules! run {
        ($command:path) => {
            if let Some(command) = $command(&args[1..]) {
                rt::finish(command())
            }
        };
    }
    match args.first().map(String::as_str) {
        // One arm per ported command, added once its parity cases pass.
        Some("auth") if native() => run!(commands::auth::command),
        Some("spaces" | "rooms" | "ls") if native() => run!(commands::spaces::command),
        Some("read") if native() => run!(commands::read::command),
        _ => {}
    }
    js_fallback::run(JS_ENTRY)
}
