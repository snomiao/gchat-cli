// The command line as a whole: what yargs answers by itself (handed back),
// and that the user's locale changes yargs's words but nothing Rust prints.
export default function (kit) {
  const { add, back, rule, json, spacesRule, messagesRule, AUTH_STATUS, SPACES_LIST, ALL_SCOPES } = kit;
  const DIRECT = "spaces/AAAAeng1";

  back("cli: no command", [], {});
  back("cli: --version", ["--version"], {});
  back("cli: --help", ["--help"], {});
  back("cli: -h", ["-h"], {});
  back("cli: unknown command", ["status"], {});
  back("cli: a command in the wrong letter case", ["Auth"], {});
  back("cli: the old wait command is gone", ["wait", "Engineering"], {});
  back("cli: an empty first argument", ["", "auth"], {});
  back("cli: --version before a command", ["--version", "spaces"], { gws: [spacesRule()] });
  back("cli: an unknown option alone", ["--verbose"], {});
  back("cli: GCHAT_CLI_NO_NATIVE and --version", ["--version"], { env: { GCHAT_CLI_NO_NATIVE: "1" } });

  // yargs speaks the user's language; ts/cli.ts carries its locale files.
  // (The bundled dist/cli.js does not, so these also pin the hand-back entry.)
  back("cli: --help in Japanese", ["--help"], { env: { LC_ALL: "ja_JP.UTF-8" } });
  back("cli: a usage error in German", ["read"], { env: { LC_ALL: "de_DE.UTF-8" } });
  back("cli: an invalid choice in French", ["auth", "--format", "xml"], { env: { LANG: "fr_FR.UTF-8" } });
  back("cli: an unknown argument in Chinese", ["spaces", "--refresh"], { env: { LC_MESSAGES: "zh_CN.UTF-8" } });

  // The commands' own output is English everywhere, and spaces are ordered
  // the same way whatever the locale's collation rules are.
  const status = [rule(AUTH_STATUS, json({ auth_method: "oauth2", scopes: ALL_SCOPES.slice(0, 1) }))];
  add("cli: auth under a Japanese locale", ["auth"], { gws: status, env: { LC_ALL: "ja_JP.UTF-8" } });
  add("cli: read under a Turkish locale", ["read", DIRECT, "-n", "2"], { gws: [messagesRule()], env: { LC_ALL: "tr_TR.UTF-8", LANG: "tr_TR.UTF-8" } });
  const times = ["2026-07-07T07:41:50Z", "2026-07-07T07:41:50.5Z", "2026-07-07T07:41:50.123456Z", "2026-07-07T07:41:50.55Z", "2026-07-07T07:41:51Z", "2026-07-06T23:59:59.999Z", undefined, "2026-07-07T07:41:50.500Z", "2025-12-31T00:00:00Z"];
  const mixed = [rule(SPACES_LIST, json({ spaces: times.map((lastActiveTime, i) => ({ name: `spaces/s${i}`, displayName: lastActiveTime ?? "never", lastActiveTime })) }))];
  for (const locale of ["th_TH.UTF-8", "ja_JP.UTF-8", "sv_SE.UTF-8", "de_DE.UTF-8", "en_US.UTF-8", "C", "POSIX", "zh_Hant_TW", "ar_EG.UTF-8"]) {
    add(`cli: spaces are ordered the same under ${locale}`, ["spaces"], { gws: mixed, env: { LC_ALL: locale, LANG: locale } });
  }
}
