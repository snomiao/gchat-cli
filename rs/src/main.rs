//! gchat-cli — Rust entry point.
//!
//! Installed from npm, this binary is the command users run. A command runs
//! here once it has been ported and a parity test shows it behaves like the
//! TypeScript; until then it is handed back to the JavaScript the package
//! still ships, so nothing changes for users.

mod js_fallback;

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
#[allow(dead_code)]
fn native() -> bool {
    std::env::var_os("GCHAT_CLI_NO_NATIVE").is_none()
}

fn main() {
    // An argument that is not valid Unicode is handed back like anything else
    // Rust does not handle (`std::env::args` would panic on it).
    let args: Option<Vec<String>> = std::env::args_os().skip(1).map(|a| a.into_string().ok()).collect();
    let Some(args) = args else { js_fallback::run(JS_ENTRY) };
    match args.first().map(String::as_str) {
        // Ported commands go here, one arm each, once their parity cases pass:
        //   Some("status") if native() => status::run(&args[1..]),
        _ => js_fallback::run(JS_ENTRY),
    }
}
