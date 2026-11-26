#!/usr/bin/env node
// Writes rs/parity.json, the parity cases for gchat (Rust against TypeScript).
//
//   node rs/parity.gen.mjs          # rewrite rs/parity.json for this checkout
//   node rs/parity.gen.mjs --list   # print the case names
//
// Then, from the repository root (after `bun install`):
//
//   node <rustify>/templates/parity/parity.mjs --cases rs/parity.json \
//     --ts "bun ts/cli.ts" --rs "rs/target/release/gchat-cli"
//
// The cases are generated for two reasons. Nearly every one needs the same
// scenery (a fake `gws`, a space list, a cache file of a certain age). And the
// runner cannot put the checkout's location into a case, which these need
// twice: for the fake gws, and for GCHAT_CLI_PACKAGE_ROOT, so that an
// invocation the binary hands back finds the JavaScript. So rs/parity.json
// carries absolute paths of the checkout it was written in; every case first
// checks that they exist, and CI regenerates the file before running it.
//
// A case says whether Rust is expected to run it or to hand it back:
//   add(...)   Rust runs it. The binary is given no JavaScript to hand back
//              to, so a case that passes was really answered by Rust.
//   back(...)  Rust hands it back at once (a command line that is yargs's to
//              answer, a gws that cannot be started).
//   late(...)  Rust hands it back after gws answered with something the
//              TypeScript was not written for. The JavaScript asks again, so
//              gws sees the same read-only call twice; these cases compare
//              which calls were made, not how often.
//
// Nothing here touches the network. gchat only ever talks to `gws`, and every
// case points both implementations at rs/parity/gws, a script that answers
// from the case's own gws.json and records what it was asked (see
// rs/parity/fake-gws.mjs). The record is printed after each run, so the exact
// arguments each implementation built for gws are compared too.
//
// Layout of one run (the runner gives every case its own directories):
//   <CWD>             the command runs here; gws.json, gws-calls.jsonl
//   <CWD>/tmp         TMPDIR, so the pending-send files are per run
//   <HOME>/.config    where the space cache goes

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.dirname(HERE);
const FAKE_DIR = path.join(HERE, "parity");
const FAKE = path.join(FAKE_DIR, "gws");
const BUN_DIR = path.dirname(execFileSync("sh", ["-c", "command -v bun"], { encoding: "utf8" }).trim());

const sq = (text) => `'${String(text).replace(/'/g, `'\\''`)}'`;

// ── what the fake gws answers ────────────────────────────────────────────────

const SPACES_LIST = ["chat", "spaces", "list"];
const MESSAGES_LIST = ["chat", "spaces", "messages", "list"];
const MESSAGES_CREATE = ["chat", "spaces", "messages", "create"];
const AUTH_STATUS = ["auth", "status"];
const PEOPLE_GET = ["people", "people", "get"];

/** One rule of gws.json: calls starting with `args` get `replies` in turn. */
const rule = (args, replies, has) => ({ args, ...(has ? { has } : {}), replies: [].concat(replies) });
const json = (value, more = {}) => ({ json: value, ...more });
const apiError = (code, message, more = {}) => ({
  json: { error: { code, message, reason: "unknown" } },
  stderr: `error[api]: ${message}\n`,
  exit: 1,
  ...more,
});

const eng = {
  name: "spaces/AAAAeng1",
  displayName: "Engineering",
  spaceType: "SPACE",
  spaceUri: "https://chat.google.com/room/AAAAeng1",
  lastActiveTime: "2026-07-07T07:41:50.123456Z",
  membershipCount: { joinedDirectHumanUserCount: 12 },
};
const leads = { name: "spaces/AAAAeng2", displayName: "Engineering Leads", spaceType: "SPACE", lastActiveTime: "2026-07-08T01:00:00Z" };
const dm = { name: "spaces/BBBBdm01", spaceType: "DIRECT_MESSAGE", lastActiveTime: "2026-07-06T10:00:00.500Z" };
const group = { name: "spaces/CCCCgrp1", displayName: "launch party 🚀", spaceType: "GROUP_CHAT" };
const ja = { name: "spaces/DDDDja01", displayName: "日本語チーム", spaceType: "SPACE", lastActiveTime: "2026-07-07T07:41:50Z" };
const WORLD = [eng, leads, dm, group, ja];
const spacesRule = (spaces = WORLD) => rule(SPACES_LIST, json({ spaces }));

const ME = "users/114836537158851875650";
// Newest first, as the API returns them.
const m5 = {
  name: "spaces/AAAAeng1/messages/THR3.MSG5",
  text: "deploy done ✅",
  createTime: "2026-07-07T09:15:00.999999Z",
  sender: { name: ME, type: "HUMAN" },
  thread: { name: "spaces/AAAAeng1/threads/THR3" },
};
const m4 = {
  name: "spaces/AAAAeng1/messages/THR2.MSG4",
  text: "line one\n\n   line two\r\n\tline three  ",
  createTime: "2026-07-07T08:59:59.9999Z",
  sender: { name: "users/99", type: "BOT" },
  thread: { name: "spaces/AAAAeng1/threads/THR2" },
  threadReply: true,
};
const m3 = {
  name: "spaces/AAAAeng1/messages/THR1.MSG3",
  formattedText: "*bold* only formatted",
  createTime: "2026-07-06T23:30:00Z",
  sender: { name: "users/1234567", displayName: "Ada Lovelace", type: "HUMAN" },
};
const m2 = {
  name: "spaces/AAAAeng1/messages/MSG2",
  argumentText: "argument text only",
  createTime: "2026-07-06T12:00:00+09:00",
  sender: { name: "bots/weird" },
};
const m1 = { name: "spaces/AAAAeng1/messages/THR0.MSG1", createTime: "2026-01-01T00:00:00Z" };
const MESSAGES = [m5, m4, m3, m2, m1];
const messagesRule = (messages = MESSAGES, has) => rule(MESSAGES_LIST, json({ messages }), has);

const SCOPE = "https://www.googleapis.com/auth/";
const ALL_SCOPES = [
  `${SCOPE}chat.spaces.readonly`,
  `${SCOPE}chat.messages.readonly`,
  `${SCOPE}chat.messages.create`,
  `${SCOPE}drive`,
];

// ── the cases ────────────────────────────────────────────────────────────────

const CALLS = "cat gws-calls.jsonl";
const CALLS_DISTINCT = "sort -u gws-calls.jsonl";
// Not a directory: with this as the package root the binary has no JavaScript.
const NO_JAVASCRIPT = "/nonexistent/no-javascript-for-this-case";
// The cache file, and the modes of what was created to hold it. (bun leaves a
// transpiler cache elsewhere under HOME, so HOME is not listed as a whole.)
const CACHE = `cat "$HOME/.config/gchat-cli/spaces.json"; find "$HOME/.config" -printf '%M %P\\n' | sort`;
const PENDING = `for f in tmp/gchat-cli-*; do echo "$f"; stat -c %a "$f"; cat "$f"; echo; done`;

// Both paths are baked into the file; a stale file must fail, not pass.
const GUARD = `test -x ${sq(FAKE)} && test -f ${sq(path.join(REPO, "ts/cli.ts"))} && test -d ${sq(path.join(REPO, "node_modules/yargs"))}`;

const cases = [];

/**
 * @param {string} name
 * @param {string[]} args
 * @param {object} [o]
 *   gws      rules for gws.json (omit: the fake answers nothing, exit 97)
 *   env      extra environment; a null value removes a default
 *   files    extra files in the working directory
 *   cache    { spaces, age } a space cache written `age` seconds ago, or { raw }
 *   pending  { space, message, age } a pending send written `age` seconds ago, or { ..., raw }
 *   setup    extra setup commands
 *   after    probes (default: the calls the fake gws received)
 *   handed   "back" or "late" (set by back() and late())
 */
function add(name, args, o = {}) {
  const env = { TZ: "UTC", GCHAT_GWS_BIN: FAKE, GCHAT_CLI_PACKAGE_ROOT: o.handed ? REPO : NO_JAVASCRIPT, ...(o.env || {}) };
  for (const key of Object.keys(env)) if (env[key] === null) delete env[key];
  const files = { "tmp/.keep": "", ...(o.gws ? { "gws.json": JSON.stringify({ rules: o.gws }) } : {}), ...(o.files || {}) };
  const setup = [GUARD];
  if (o.cache) {
    files["cache.tpl"] = o.cache.raw ?? JSON.stringify({ fetched_at: "__T__", spaces: o.cache.spaces }, null, 2).replace('"__T__"', "__T__") + "\n";
    setup.push(
      `mkdir -p "$HOME/.config/gchat-cli" && sed "s/__T__/$(( ($(date +%s) - ${o.cache.age ?? 0}) * 1000 ))/" cache.tpl > "$HOME/.config/gchat-cli/spaces.json"`,
    );
  }
  if (o.pending) {
    const { space, message, age = 0, raw } = o.pending;
    files["pending.tpl"] = raw ?? JSON.stringify({ space_arg: space, message, created_at: "__T__" }).replace('"__T__"', "__T__");
    setup.push(`sed "s/__T__/$(( ($(date +%s) - ${age}) * 1000 ))/" pending.tpl > tmp/gchat-cli-pending-${code(space, message)}.json`);
  }
  setup.push(...(o.setup || []));
  if (cases.some((c) => c.name === name)) throw new Error(`duplicate case name: ${name}`);
  const after = o.after ?? [CALLS];
  cases.push({
    name,
    args,
    env,
    files,
    setup,
    after: o.handed === "late" ? after.map((probe) => (probe === CALLS ? CALLS_DISTINCT : probe)) : after,
    ...(o.timeout ? { timeout: o.timeout } : {}),
    ...(o.handed ? { handed: o.handed } : {}),
  });
}
const back = (name, args, o = {}) => add(name, args, { ...o, handed: "back" });
const late = (name, args, o = {}) => add(name, args, { ...o, handed: "late" });

/** The confirm code `gchat send` derives from its two arguments. */
function code(space, message) {
  return createHash("sha256").update(`${space}\x00${message}`).digest("hex").slice(0, 8);
}

// Cases are added by the files below, one per command.
const parts = ["auth", "spaces", "read", "send", "tail", "watch", "cli"];
const kit = {
  add, back, late, code, rule, json, apiError, spacesRule, messagesRule, sq,
  SPACES_LIST, MESSAGES_LIST, MESSAGES_CREATE, AUTH_STATUS, PEOPLE_GET,
  WORLD, eng, leads, dm, group, ja, MESSAGES, m1, m2, m3, m4, m5, ME, SCOPE, ALL_SCOPES,
  CALLS, CALLS_DISTINCT, CACHE, PENDING, FAKE, FAKE_DIR, BUN_DIR, REPO,
};
for (const part of parts) {
  const file = path.join(FAKE_DIR, `cases-${part}.mjs`);
  if (fs.existsSync(file)) (await import(file)).default(kit);
}

if (process.argv.includes("--list")) {
  for (const c of cases) console.log(c.name);
  process.exit(0);
}

const spec = {
  "//": "Generated by rs/parity.gen.mjs — edit rs/parity/cases-*.mjs, then run `node rs/parity.gen.mjs`.",
  env: {
    // Relative on purpose: the pending-send files then land in the run's own
    // directory instead of a temp directory shared by every run.
    TMPDIR: "tmp",
  },
  // The two clock readings gchat writes to disk.
  normalize: [
    ['"fetched_at": \\d+', '"fetched_at": <T>'],
    ['"created_at":\\d+', '"created_at":<T>'],
  ],
  cases,
};
fs.writeFileSync(path.join(HERE, "parity.json"), JSON.stringify(spec, null, 1) + "\n");
const handed = cases.filter((c) => c.handed).length;
console.log(`wrote rs/parity.json for ${REPO}: ${cases.length} cases, ${cases.length - handed} run by Rust, ${handed} handed back`);
