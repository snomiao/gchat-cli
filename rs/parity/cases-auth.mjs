// `gchat auth`, and with it everything every command shares: how gws is
// found and started, how its output and its failures are read, and how JSON is
// printed again.
export default function ({ add, back, late, rule, json, apiError, AUTH_STATUS, SCOPE, ALL_SCOPES, FAKE_DIR, BUN_DIR, sq }) {
  const status = (value, more) => [rule(AUTH_STATUS, json(value, more))];
  const raw = (stdout, more = {}) => [rule(AUTH_STATUS, { stdout, ...more })];

  // ── the report ──
  add("auth: every Chat scope granted", ["auth"], {
    gws: status({ auth_method: "oauth2", scopes: ALL_SCOPES, scope_count: 4, token_valid: true }),
  });
  add("auth: two scopes missing, exit 1", ["auth"], {
    gws: status({ auth_method: "oauth2", scopes: [`${SCOPE}chat.spaces.readonly`, `${SCOPE}drive`], scope_count: 2 }),
  });
  add("auth: only the send scope missing", ["auth"], {
    gws: status({ auth_method: "service_account", scopes: ALL_SCOPES.slice(0, 2) }),
  });
  add("auth: no scopes and no method reported", ["auth"], { gws: status({}) });
  add("auth: scope count falls back to the number of distinct scopes", ["auth"], {
    gws: status({ auth_method: "oauth2", scopes: [...ALL_SCOPES, ...ALL_SCOPES, "x", "x"] }),
  });
  add("auth: scopes null, count zero is still shown", ["auth"], { gws: status({ auth_method: "none", scopes: null, scope_count: 0 }) });
  add("auth: method and count that are not strings", ["auth"], {
    gws: status({ auth_method: 12.5, scopes: ALL_SCOPES, scope_count: "four" }),
  });
  add("auth: method true, count a large number", ["auth"], { gws: status({ auth_method: true, scopes: ALL_SCOPES, scope_count: 1e21 }) });
  add("auth: distinct count over mixed scope values", ["auth"], {
    gws: status({ scopes: [1, 1, "1", true, true, null, null, 0, -0, [], [], {}, {}, "a", "a", 1.5, 1.5, false] }),
  });
  add("auth: scope names are matched exactly", ["auth"], {
    gws: status({ scopes: ["chat.spaces.readonly", `${SCOPE}chat.messages.readonly `, `${SCOPE}CHAT.MESSAGES.CREATE`] }),
  });
  add("auth: --format text", ["auth", "--format", "text"], { gws: status({ auth_method: "oauth2", scopes: ALL_SCOPES }) });
  add("auth: --format=text", ["auth", "--format=text"], { gws: status({ auth_method: "oauth2", scopes: ALL_SCOPES }) });

  // ── JSON out ──
  add("auth: --format json prints the status indented", ["auth", "--format", "json"], {
    gws: status({ auth_method: "oauth2", scopes: ALL_SCOPES, scope_count: 4, nested: { a: [], b: {}, c: [1, [2, { d: null }]] }, ok: true }),
  });
  add("auth: --format=json", ["auth", "--format=json"], { gws: status({ auth_method: "oauth2", scopes: [] }) });
  add("auth: json with missing scopes still exits 0", ["auth", "--format", "json"], { gws: status({ scopes: [] }) });
  add("auth: json numbers are printed the JavaScript way", ["auth", "--format", "json"], {
    gws: raw(
      '{"a":1.0,"b":1.50,"c":1e21,"d":1e-7,"e":-0,"f":12345678901234567890,"g":0.1,"h":1E5,"i":5e-324,"j":1.7976931348623157e308,' +
        '"k":1e999,"l":-1e999,"m":123456789012345680000,"n":0.000001,"o":1.23e-18,"p":-0.0,"q":100,"r":9007199254740993,"s":2.5e+3,"t":0e0,"u":1e20,"v":123.456e-2}',
    ),
  });
  add("auth: json strings are escaped the JavaScript way", ["auth", "--format", "json"], {
    gws: raw(
      '{"quote":"a\\"b","back":"a\\\\b","slash":"a\\/b","ctl":"\\u0000\\u0001\\b\\f\\n\\r\\t\\u001f\\u007f","sep":"\\u2028\\u2029",' +
        '"pair":"\\ud83d\\ude00","raw":"😀 é 日本","upper":"\\u00E9\\u00e9","key\\n\\"":"v"}',
    ),
  });
  add("auth: json keys that look like numbers come first", ["auth", "--format", "json"], {
    gws: raw('{"b":1,"10":2,"2":3,"a":4,"01":5,"-1":6,"4294967294":7,"4294967295":8,"1.5":9,"0":10,"":11," 3":12}'),
  });
  add("auth: json duplicate keys, the last value wins", ["auth", "--format", "json"], {
    gws: raw('{"a":1,"b":2,"a":{"x":1},"b":[1],"__proto__":{"y":2},"constructor":3,"a":"last"}'),
  });
  add("auth: json that is not an object", ["auth", "--format", "json"], { gws: raw('["x", 1, null, true, {"k": []}]') });
  add("auth: json string", ["auth", "--format", "json"], { gws: raw('"just a string"') });
  add("auth: json number", ["auth", "--format", "json"], { gws: raw("42") });
  add("auth: json with odd whitespace around it", ["auth", "--format", "json"], {
    gws: raw('﻿  \t\r\n{ "a" : [ 1 ,\n 2 ] ,\t"b":{ } } 　\n\n'),
  });
  add("auth: json pretty-printed by gws", ["auth", "--format", "json"], {
    gws: [rule(AUTH_STATUS, json({ auth_method: "oauth2", scopes: ALL_SCOPES, deep: { er: { est: [1, 2, 3] } } }, { pretty: true }))],
  });
  add("auth: text report from a status that is an array", ["auth"], { gws: raw("[1,2,3]") });
  add("auth: text report from a status that is a string", ["auth"], { gws: raw('"oauth2"') });
  add("auth: invalid UTF-8 from gws", ["auth", "--format", "json"], {
    gws: [rule(AUTH_STATUS, { base64: Buffer.from([0x7b, 0x22, 0x61, 0x22, 0x3a, 0x22, 0xff, 0xc3, 0x28, 0xe2, 0x82, 0x22, 0x7d]).toString("base64") })],
  });

  // ── gws fails ──
  add("auth: API error envelope with a code", ["auth"], { gws: [rule(AUTH_STATUS, apiError(401, "Request had invalid authentication credentials."))] });
  add("auth: missing scope (403) points at gchat auth", ["auth"], {
    gws: [rule(AUTH_STATUS, apiError(403, "Request had insufficient authentication scopes."))],
  });
  add("auth: 403 scope message in other letter case", ["auth"], {
    gws: [rule(AUTH_STATUS, apiError(403, "PERMISSION: Insufficient Authentication SCOPES for this call"))],
  });
  add("auth: 403 that is not about scopes", ["auth"], { gws: [rule(AUTH_STATUS, apiError(403, "The caller does not have permission"))] });
  add("auth: scope message with another code", ["auth"], { gws: [rule(AUTH_STATUS, apiError(401, "insufficient authentication scopes"))] });
  add("auth: code 403 given as a string is not a scope error", ["auth"], {
    gws: status({ error: { code: "403", message: "insufficient authentication scopes" } }, { exit: 1 }),
  });
  add("auth: error envelope with exit 0 is still an error", ["auth"], { gws: status({ error: { code: 500, message: "backend" } }) });
  add("auth: error envelope without a message", ["auth"], { gws: status({ error: { code: 503 } }, { exit: 1 }) });
  add("auth: error envelope without a code", ["auth"], { gws: status({ error: { message: "no code here" } }, { exit: 1 }) });
  add("auth: error envelope with code 0", ["auth"], { gws: status({ error: { code: 0, message: "zero" } }, { exit: 1 }) });
  add("auth: error envelope with a fractional code", ["auth"], { gws: status({ error: { code: 429.5, message: "odd" } }, { exit: 1 }) });
  add("auth: error that is a string", ["auth"], { gws: status({ error: "boom" }, { exit: 1 }) });
  add("auth: error that is an empty object", ["auth"], { gws: status({ error: {} }) });
  add("auth: error with a message that is not a string", ["auth"], { gws: status({ error: { code: 400, message: 12 } }, { exit: 1 }) });
  add("auth: error with a message that is a list", ["auth"], { gws: status({ error: { code: 400, message: ["a", null, [1, 2], { x: 1 }, true] } }, { exit: 1 }) });
  add("auth: error with a message that is null", ["auth"], { gws: status({ error: { code: 400, message: null } }, { exit: 1 }) });
  add("auth: a falsy error is no error", ["auth"], { gws: status({ error: null, auth_method: "oauth2", scopes: ALL_SCOPES }) });
  add("auth: a falsy error with a failing exit", ["auth"], { gws: status({ error: 0 }, { exit: 4, stderr: "gws: something went wrong\n" }) });
  add("auth: error message cut at 300 characters", ["auth"], {
    gws: [rule(AUTH_STATUS, apiError(400, `${"x".repeat(295)}|END|this part is cut off`))],
  });
  add("auth: the cut can split an emoji", ["auth"], { gws: [rule(AUTH_STATUS, apiError(400, `${"y".repeat(299)}😀tail`))] });
  add("auth: an emoji just inside the cut", ["auth"], { gws: [rule(AUTH_STATUS, apiError(400, `${"y".repeat(298)}😀tail`))] });
  add("auth: failing exit, stderr is reported without the keyring line", ["auth"], {
    gws: [rule(AUTH_STATUS, { exit: 2, stderr: "\n  \nerror[auth]: no credentials found\nusing KEYRING backend: file\n  run `gws auth login`  \n\n" })],
  });
  add("auth: failing exit, nothing but the keyring line", ["auth"], { gws: [rule(AUTH_STATUS, { exit: 2 })] });
  add("auth: failing exit, no output at all", ["auth"], { gws: [rule(AUTH_STATUS, { exit: 7, noise: false })] });
  add("auth: failing exit with valid JSON and stderr", ["auth"], {
    gws: status({ auth_method: "oauth2" }, { exit: 1, stderr: "warning: token expired\n" }),
  });
  add("auth: gws killed by a signal", ["auth"], { gws: [rule(AUTH_STATUS, { signal: "SIGKILL" })] });
  add("auth: gws killed by a signal after printing JSON", ["auth"], { gws: status({ auth_method: "oauth2" }, { signal: "SIGTERM" }) });
  add("auth: output that is not JSON, exit 0", ["auth"], { gws: raw(`  Logged in as someone@example.com ${"z".repeat(250)}\n`) });
  add("auth: output that is not JSON, failing exit, with stderr", ["auth"], {
    gws: raw("not json at all\n", { exit: 1, stderr: "error: bad things\n" }),
  });
  add("auth: output that is not JSON, failing exit, no stderr", ["auth"], { gws: raw("  not json at all  \n", { exit: 1 }) });
  add("auth: truncated JSON", ["auth"], { gws: raw('{"auth_method": "oauth2", "scopes": [') });
  add("auth: JSON with a trailing comma is not JSON", ["auth"], { gws: raw('{"a": 1,}') });
  add("auth: JSON with a comment is not JSON", ["auth"], { gws: raw('{"a": 1} // done') });
  add("auth: two JSON values are not JSON", ["auth"], { gws: raw('{"a": 1}\n{"b": 2}\n') });
  add("auth: a leading plus sign is not JSON", ["auth"], { gws: raw("+1") });
  add("auth: a leading zero is not JSON", ["auth"], { gws: raw("[01]") });
  add("auth: a raw tab in a string is not JSON", ["auth"], { gws: raw('{"a":"x\ty"}') });
  add("auth: single quotes are not JSON", ["auth"], { gws: raw("{'a': 1}") });
  add("auth: NaN is not JSON", ["auth"], { gws: raw("NaN") });
  add("auth: no rule in the fake (exit 96)", ["auth"], { gws: [] });

  add("auth: empty output as json", ["auth", "--format", "json"], { gws: [rule(AUTH_STATUS, {})] });
  add("auth: method that is an object", ["auth"], { gws: status({ auth_method: { kind: "oauth2" }, scopes: ALL_SCOPES }) });
  add("auth: method that is a list", ["auth"], { gws: status({ auth_method: ["a", ["b"], null], scopes: ALL_SCOPES }) });

  // ── things the JavaScript still answers ──
  // An answer from gws that the TypeScript was not written for: what happens
  // then is up to the JavaScript runtime (a TypeError and its wording, a list
  // made of a string's letters). Rust sees the answer and hands back.
  late("auth: empty output, exit 0 (status is null)", ["auth"], { gws: [rule(AUTH_STATUS, {})] });
  late("auth: status null", ["auth"], { gws: raw("null") });
  late("auth: scopes that are not a list", ["auth"], { gws: status({ scopes: "abc" }) });
  late("auth: scopes that are a number", ["auth"], { gws: status({ scopes: 5 }) });
  late("auth: a lone surrogate in the output", ["auth", "--format", "json"], { gws: raw('{"a":"x\\ud800y"}') });
  // Command lines yargs answers, or reads in a way of its own.
  back("auth: unknown format", ["auth", "--format", "yaml"], { gws: status({}) });
  back("auth: format given twice", ["auth", "--format", "json", "--format", "text"], { gws: status({ scopes: ALL_SCOPES }) });
  back("auth: format without a value", ["auth", "--format"], { gws: status({}) });
  back("auth: empty format", ["auth", "--format="], { gws: status({}) });
  back("auth: unknown option", ["auth", "--verbose"], { gws: status({}) });
  back("auth: unexpected argument", ["auth", "now"], { gws: status({}) });
  back("auth: empty argument", ["auth", ""], { gws: status({}) });
  back("auth: --help", ["auth", "--help"], { gws: status({}) });
  back("auth: -h", ["auth", "-h"], { gws: status({}) });
  back("auth: --version after the command", ["auth", "--version"], { gws: status({}) });
  back("auth: option before the command", ["--format", "json", "auth"], { gws: status({ scopes: ALL_SCOPES }) });
  back("auth: format value in quotes", ["auth", '--format="json"'], { gws: status({ scopes: ALL_SCOPES }) });
  back("auth: unknown short option", ["auth", "-x"], { gws: status({}) });
  back("auth: end-of-options marker", ["auth", "--"], { gws: status({ scopes: ALL_SCOPES }) });
  back("auth: camel-case spelling of nothing", ["auth", "--Format", "json"], { gws: status({}) });

  // ── how gws is found ──
  // A gws that cannot be started is reported in the JavaScript runtime's own
  // words ("Executable not found in $PATH", "ENOENT: …, posix_spawn"), so the
  // binary hands those invocations back: nothing has happened yet.
  back("auth: gws that does not exist (absolute path)", ["auth"], { env: { GCHAT_GWS_BIN: "/nonexistent/dir/gws" } });
  back("auth: gws that does not exist (bare name)", ["auth"], { env: { GCHAT_GWS_BIN: "gchat-parity-no-such-binary" } });
  back("auth: gws that is not executable", ["auth"], { env: { GCHAT_GWS_BIN: "./plain-file" }, files: { "plain-file": "echo {}\n" } });
  back("auth: gws that is a directory", ["auth"], { env: { GCHAT_GWS_BIN: "./tmp" } });
  add("auth: gws given relative to the working directory", ["auth"], {
    env: { GCHAT_GWS_BIN: "./my-gws" },
    files: { "my-gws": `#!/bin/sh\nexec ${sq(`${FAKE_DIR}/gws`)} "$@"\n` },
    setup: ["chmod +x my-gws"],
    gws: status({ auth_method: "oauth2", scopes: ALL_SCOPES }),
  });
  back("auth: gws that is a text file without an interpreter line", ["auth"], {
    env: { GCHAT_GWS_BIN: "./no-shebang" },
    files: { "no-shebang": "echo '{}'\n" },
    setup: ["chmod +x no-shebang"],
  });
  back("auth: gws whose interpreter does not exist", ["auth"], {
    env: { GCHAT_GWS_BIN: "./bad-shebang" },
    files: { "bad-shebang": "#!/nonexistent/interpreter\n" },
    setup: ["chmod +x bad-shebang"],
  });
  // The default name, looked up on PATH. PATH is replaced so that nothing but
  // the fake can be found under the name `gws`, whatever the machine has.
  const fakeFirst = { PATH: `${FAKE_DIR}:${BUN_DIR}:/usr/bin:/bin` };
  const onlyFake = `test "$(command -v gws)" = ${sq(`${FAKE_DIR}/gws`)}`;
  add("auth: GCHAT_GWS_BIN unset, gws from PATH", ["auth"], {
    env: { GCHAT_GWS_BIN: null, ...fakeFirst },
    setup: [onlyFake],
    gws: status({ auth_method: "oauth2", scopes: ALL_SCOPES }),
  });
  add("auth: GCHAT_GWS_BIN empty, gws from PATH", ["auth"], {
    env: { GCHAT_GWS_BIN: "", ...fakeFirst },
    setup: [onlyFake],
    gws: status({ auth_method: "oauth2", scopes: [] }),
  });
  back("auth: GCHAT_CLI_NO_NATIVE hands everything back", ["auth"], {
    env: { GCHAT_CLI_NO_NATIVE: "1" },
    gws: status({ auth_method: "oauth2", scopes: ALL_SCOPES }),
  });
}
