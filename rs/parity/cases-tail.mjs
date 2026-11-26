// `gchat tail <space>`: a backlog, then polling. A tail only ends by itself
// with --timeout or --exit-on-message, so the cases end in one of three ways,
// none of which depends on how fast the machine is:
//   - `--timeout 0`: the deadline has passed before the first wait;
//   - --exit-on-message: the fake gws hands out a new message on a chosen poll;
//   - a plain tail never stops, so on a chosen poll the fake gws ends the
//     process that called it (SIGTERM). Both implementations then have the
//     same exit status (none) and whatever they printed until then.
// Polls are 50 ms apart (`--interval 0.05`) to keep the run short.
export default function (kit) {
  const { add, back, late, rule, json, apiError, spacesRule, messagesRule, SPACES_LIST, MESSAGES_LIST, PEOPLE_GET, WORLD, eng, MESSAGES, m1, m2, m3, m4, m5, ME, CALLS, CACHE } = kit;
  const DIRECT = "spaces/AAAAeng1";
  const FAST = ["--interval", "0.05"];
  const list = (...messages) => json({ messages });
  const polls = (...replies) => rule(MESSAGES_LIST, replies);
  const me = (id = ME.slice("users/".length), type = "PROFILE") => rule(PEOPLE_GET, json({ resourceName: "people/x", metadata: { sources: [{ type, id }] } }));
  const END = { killParent: "SIGTERM" };
  const other = (n, text = `reply ${n}`) => ({
    name: `${DIRECT}/messages/NEW${n}.M${n}`,
    text,
    createTime: `2026-07-07T10:0${n}:00Z`,
    sender: { name: "users/200000000000000000002", type: "HUMAN" },
    thread: { name: `${DIRECT}/threads/NEW${n}` },
  });
  const mine = (n, text = `my own ${n}`) => ({ ...other(n, text), name: `${DIRECT}/messages/OWN${n}.M${n}`, sender: { name: ME, type: "HUMAN" } });

  // ── ends at once: --timeout 0 ──
  add("tail: --timeout 0 seeds and stops, printing nothing", ["tail", DIRECT, "--timeout", "0"], { gws: [messagesRule()] });
  add("tail: --timeout 0 by display name", ["tail", "Engineering", "--timeout", "0"], { gws: [spacesRule(), messagesRule()], after: [CALLS, CACHE] });
  add("tail: -n sets the size of the first request", ["tail", DIRECT, "-n", "3", "--timeout", "0"], { gws: [messagesRule()] });
  add("tail: --limit=0 still asks for one", ["tail", DIRECT, "--limit=0", "--timeout=0"], { gws: [messagesRule()] });
  add("tail: a negative limit still asks for one", ["tail", DIRECT, "--limit", "-4", "--timeout", "0"], { gws: [messagesRule()] });
  add("tail: <space>:<thread> tails the whole space", ["tail", "Engineering:THR1", "--timeout", "0"], { gws: [spacesRule(), messagesRule()] });
  for (const zero of ["0s", "0m", "0h", "0d", "0.0", "00", " 0 ", "0 m", "0　d", "﻿0 s\n", "0.000h"]) {
    add(`tail: a timeout of ${JSON.stringify(zero)} is zero`, ["tail", DIRECT, "--timeout", zero], { gws: [messagesRule()] });
  }
  add("tail: --timeout 0 --format json", ["tail", DIRECT, "--timeout", "0", "--format", "json"], { gws: [messagesRule()] });
  add("tail: --timeout 0 --exit-on-message asks who I am first", ["tail", "Engineering", "--timeout", "0", "--exit-on-message"], { gws: [spacesRule(), me(), messagesRule()] });
  add("tail: --timeout 0 with odd messages: nothing is rendered", ["tail", DIRECT, "--timeout", "0"], {
    gws: [messagesRule([{ text: 5, createTime: "never" }, { name: 7 }, { name: null }, { name: [1] }, 3, "x"])],
  });

  // ── a timeout that is not a duration ──
  for (const bad of ["soon", "10x", "1e3", ".5", "5.", "1.5.2", "５", "5 minutes", "1h30m", "+5", "0x10", "s"]) {
    add(`tail: ${JSON.stringify(bad)} is not a duration`, ["tail", DIRECT, "--timeout", bad], { gws: [messagesRule()] });
  }
  add("tail: a bad duration is reported after the space is resolved", ["tail", "Engineering", "--timeout", "later"], { gws: [spacesRule(), messagesRule()], after: [CALLS, CACHE] });
  add("tail: a bad duration is reported after asking who I am", ["tail", DIRECT, "--exit-on-message", "--timeout=later"], { gws: [me(), messagesRule()] });
  add("tail: an unknown space is reported before a bad duration", ["tail", "marketing", "--timeout", "later"], { gws: [spacesRule(), messagesRule()] });

  // ── ends at the deadline ──
  add("tail: the deadline cuts the wait short (interval 100 s)", ["tail", DIRECT, "--timeout", "0.3", "--interval", "100"], { gws: [polls(list(...MESSAGES), END)] });
  add("tail: the deadline with the default interval", ["tail", DIRECT, "--timeout", "0.3s"], { gws: [polls(list(...MESSAGES), END)] });
  add("tail: the deadline while waiting for a reply", ["tail", DIRECT, "--timeout", "0.3", "--interval", "100", "--exit-on-message"], {
    gws: [me(), polls(list(...MESSAGES), END)],
  });
  add("tail: new messages before the deadline are printed", ["tail", DIRECT, "--timeout", "1.5", "--interval", "0.05"], {
    gws: [polls(list(m5), list(other(1), m5))],
    // How many polls fit before the deadline depends on the machine; which
    // calls are made does not.
    after: ["sort -u gws-calls.jsonl"],
  });

  // ── --exit-on-message: wait for a reply ──
  const wait = ["tail", DIRECT, "--exit-on-message", ...FAST];
  add("tail: a reply on the first poll ends the wait", wait, { gws: [me(), polls(list(m5, m4), list(other(1), m5, m4))] });
  add("tail: quiet polls, then a reply", wait, { gws: [me(), polls(list(m5), list(m5), list(m5), list(other(1), m5))] });
  add("tail: my own message is printed but does not end the wait", wait, {
    gws: [me(), polls(list(m4), list(mine(1), m4), list(mine(1), m4), list(other(2), mine(1), m4))],
  });
  add("tail: a batch with my message and a reply ends the wait", wait, { gws: [me(), polls(list(m4), list(other(3), mine(2), other(1), m4))] });
  add("tail: several of my own, then a reply", wait, { gws: [me(), polls(list(), list(mine(1)), list(mine(2), mine(1)), list(other(3), mine(2), mine(1)))] });
  add("tail: the backlog is not printed while waiting", wait, { gws: [me(), polls(list(...MESSAGES), list(other(1), ...MESSAGES))] });
  add("tail: with -n 1 older messages count as new on the first poll", [...wait, "-n", "1"], { gws: [me(), polls(list(m5, m4, m3), list(m5, m4, m3))] });
  add("tail: with -n 0 everything counts as new on the first poll", [...wait, "--limit", "0"], { gws: [me(), polls(list(...MESSAGES), list(...MESSAGES))] });
  add("tail: with -n 2 my own older message is printed and the wait goes on", [...wait, "-n", "2"], {
    gws: [me(), polls(list(m4, m3, m5), list(m4, m3, m5), list(m4, m3, m5), list(other(1), m4, m3, m5))],
  });
  add("tail: a message sent twice in one poll is printed twice", wait, { gws: [me(), polls(list(m5), list(other(1), other(1), m5))] });
  add("tail: a reply without a sender ends the wait", wait, { gws: [me(), polls(list(m5), list({ name: `${DIRECT}/messages/X.1`, text: "who?", createTime: "2026-07-07T10:00:00Z" }, m5))] });
  add("tail: a reply from a bot ends the wait", wait, { gws: [me(), polls(list(m5), list(m4, m5))] });
  add("tail: waiting by display name", ["tail", "Leads", "--exit-on-message", ...FAST], { gws: [spacesRule(), me(), polls(list(m5), list(other(1), m5))], after: [CALLS, CACHE] });
  add("tail: waiting with a long timeout that is not reached", [...wait, "--timeout", "2h"], { gws: [me(), polls(list(m5), list(other(1), m5))] });
  add("tail: waiting, as JSON lines", [...wait, "--format", "json"], { gws: [me(), polls(list(m5), list(other(2), mine(1), m5))] });
  add("tail: JSON lines keep what gws sent", [...wait, "--format=json"], {
    gws: [me(), polls(list(), list({ name: "n1", extra: { 2: "b", 1: "a", deep: [1.5, null, 1e21] }, text: "é \"q\" \n 😀", sender: { name: "users/9" } }))],
  });
  add("tail: waiting in another time zone", wait, { gws: [me(), polls(list(m5), list(other(1), m5))], env: { TZ: "Australia/Sydney" } });
  add("tail: an integer interval of zero polls at once", ["tail", DIRECT, "--exit-on-message", "--interval", "0"], { gws: [me(), polls(list(m5), list(m5), list(other(1), m5))] });

  // who am I
  const anyone = [polls(list(m4), list(mine(1), m4))];
  add("tail: my id from a DOMAIN_PROFILE source", wait, { gws: [me(ME.slice(6), "DOMAIN_PROFILE"), polls(list(m4), list(mine(1), m4), list(other(2), mine(1), m4))] });
  add("tail: PROFILE wins over DOMAIN_PROFILE wherever it is listed", wait, {
    gws: [
      rule(PEOPLE_GET, json({ metadata: { sources: [{ type: "CONTACT", id: "1" }, { type: "DOMAIN_PROFILE", id: "777" }, { type: "PROFILE", id: ME.slice(6) }] } })),
      polls(list(m4), list(mine(1), m4), list(other(2), mine(1), m4)),
    ],
  });
  add("tail: an id that is a number", wait, {
    gws: [rule(PEOPLE_GET, json({ metadata: { sources: [{ type: "PROFILE", id: 4242 }] } })), polls(list(), list({ name: "a", text: "from 4242", sender: { name: "users/4242" } }), list({ name: "b", text: "from someone else", sender: { name: "users/4243" } }))],
  });
  add("tail: without my id any new message ends the wait (People API error)", wait, { gws: [rule(PEOPLE_GET, apiError(403, "Request had insufficient authentication scopes.")), ...anyone] });
  add("tail: without my id (no rule, failing exit)", wait, { gws: anyone });
  add("tail: without my id (not JSON)", wait, { gws: [rule(PEOPLE_GET, { stdout: "nope" }), ...anyone] });
  add("tail: without my id (empty answer)", wait, { gws: [rule(PEOPLE_GET, {}), ...anyone] });
  add("tail: without my id (no metadata)", wait, { gws: [rule(PEOPLE_GET, json({ resourceName: "people/1" })), ...anyone] });
  add("tail: without my id (metadata null)", wait, { gws: [rule(PEOPLE_GET, json({ metadata: null })), ...anyone] });
  add("tail: without my id (no sources)", wait, { gws: [rule(PEOPLE_GET, json({ metadata: {} })), ...anyone] });
  add("tail: without my id (no profile source)", wait, { gws: [rule(PEOPLE_GET, json({ metadata: { sources: [{ type: "CONTACT", id: "5" }] } })), ...anyone] });
  add("tail: without my id (profile without id)", wait, { gws: [rule(PEOPLE_GET, json({ metadata: { sources: [{ type: "PROFILE" }, { type: "DOMAIN_PROFILE", id: "9" }] } })), ...anyone] });
  add("tail: without my id (empty id)", wait, { gws: [rule(PEOPLE_GET, json({ metadata: { sources: [{ type: "PROFILE", id: "" }] } })), ...anyone] });
  add("tail: without my id (sources is not a list)", wait, { gws: [rule(PEOPLE_GET, json({ metadata: { sources: "PROFILE" } })), ...anyone] });
  add("tail: without my id (a null source comes first)", wait, { gws: [rule(PEOPLE_GET, json({ metadata: { sources: [null, { type: "PROFILE", id: ME.slice(6) }] } })), ...anyone] });
  add("tail: my id is found before a null source", wait, {
    gws: [rule(PEOPLE_GET, json({ metadata: { sources: [{ type: "PROFILE", id: ME.slice(6) }, null] } })), polls(list(m4), list(mine(1), m4), list(other(2), mine(1), m4))],
  });
  add("tail: without my id (the answer is a list)", wait, { gws: [rule(PEOPLE_GET, json([1, 2])), ...anyone] });

  // ── poll errors do not end a tail ──
  add("tail: an API error on a poll is reported and the wait goes on", wait, {
    gws: [me(), polls(list(m5), apiError(500, "Internal error encountered."), list(m5), apiError(403, "Request had insufficient authentication scopes."), list(other(1), m5))],
  });
  add("tail: a poll that prints no JSON", wait, { gws: [me(), polls(list(m5), { stdout: "<html>502</html>" }, list(other(1), m5))] });
  add("tail: a poll that fails without output", wait, { gws: [me(), polls(list(m5), { exit: 5 }, { exit: 6, stderr: "gws: network unreachable\n" }, list(other(1), m5))] });
  add("tail: a poll killed by a signal", wait, { gws: [me(), polls(list(m5), { signal: "SIGKILL" }, list(other(1), m5))] });
  add("tail: a long poll error is not cut", wait, { gws: [me(), polls(list(m5), apiError(500, "e".repeat(400)), list(other(1), m5))] });
  add("tail: a poll with empty output", wait, { gws: [me(), polls(list(m5), {}, list(other(1), m5))] });
  add("tail: a poll with a null message", wait, { gws: [me(), polls(list(m5), list(other(1), null, m5), list(other(2), m5))] });
  add("tail: a poll with messages that is not a list", wait, { gws: [me(), polls(list(m5), json({ messages: "abc" }), json({ messages: { a: 1 } }), list(other(1), m5))] });
  add("tail: a new message without a name or thread stops its batch", wait, {
    gws: [me(), polls(list(m5), list(other(2), { text: "no name", createTime: "2026-07-07T10:00:00Z" }, other(1), m5), list(other(3), other(2), other(1), m5))],
  });
  add("tail: a new message whose text is a number stops its batch", wait, {
    gws: [me(), polls(list(m5), list({ name: "x1", text: 12, createTime: "2026-07-07T10:00:00Z" }, other(1), m5), list(other(2), m5))],
  });
  add("tail: a new message whose sender name is a number stops its batch", wait, {
    gws: [me(), polls(list(m5), list({ name: "x1", text: "t", createTime: "2026-07-07T10:00:00Z", sender: { name: 12 } }, m5), list(other(2), m5))],
  });
  add("tail: messages without a name are all one message", wait, {
    gws: [me(), polls(list({ text: "seeded without a name", createTime: "2026-07-07T10:00:00Z", thread: { name: "t/A" } }), list({ text: "also nameless", createTime: "2026-07-07T10:00:00Z", thread: { name: "t/B" } }), list(other(1)))],
  });
  add("tail: names that are not strings", [...wait, "--format", "json"], {
    gws: [me(), polls(list({ name: 1 }, { name: null }, { name: true }), list({ name: 1, n: "seen" }, { name: "1", n: "new: a string" }, { name: null, n: "seen" }, { name: true, n: "seen" }, { name: false, n: "new" }, { name: [1], n: "new: a list is never seen" }, { name: 1.0, n: "seen" }))],
  });

  // ── a plain tail: backlog, then new messages, until stopped ──
  const plain = ["tail", DIRECT, ...FAST];
  add("tail: backlog oldest first, then new messages as they come", plain, {
    gws: [polls(list(...MESSAGES), list(...MESSAGES), list(other(1), ...MESSAGES), list(other(1), ...MESSAGES), list(other(3), mine(2), other(1), ...MESSAGES), END)],
  });
  add("tail: -n 2 prints two of the backlog and treats the rest as new", [...plain, "-n", "2"], { gws: [polls(list(...MESSAGES), list(...MESSAGES), END)] });
  add("tail: an empty space, then a first message", plain, { gws: [polls(list(), list(), list(other(1)), END)] });
  add("tail: backlog as JSON lines", [...plain, "--format", "json", "-n", "3"], { gws: [polls(list(...MESSAGES), list(other(1), ...MESSAGES), END)] });
  add("tail: poll errors in a plain tail", plain, { gws: [polls(list(m5), apiError(503, "The service is currently unavailable."), list(other(1), m5), END)] });
  add("tail: by display name, stopped on the second poll", ["tail", "Engineering", ...FAST], { gws: [spacesRule(), polls(list(m5, m4), list(m5, m4), END)], after: [CALLS, CACHE] });
  add("tail: stopped by SIGINT", plain, { gws: [polls(list(m5), list(other(1), m5), { killParent: "SIGINT" })] });
  add("tail: the first request honours --limit, later ones ask for 25", [...plain, "--limit", "7"], { gws: [polls(list(m5), END)] });

  // ── failures before the tail starts ──
  add("tail: the first request fails (404)", ["tail", "spaces/NOPE", ...FAST], { gws: [rule(MESSAGES_LIST, apiError(404, "Space not found."))] });
  add("tail: the first request fails for lack of scope", plain, { gws: [rule(MESSAGES_LIST, apiError(403, "Request had insufficient authentication scopes."))] });
  add("tail: no such space", ["tail", "marketing", ...FAST], { gws: [spacesRule()] });
  add("tail: ambiguous space", ["tail", "Engineer", "--exit-on-message"], { gws: [spacesRule(), me()] });
  add("tail: the first request prints no JSON", [...wait], { gws: [me(), rule(MESSAGES_LIST, { stdout: "not json" })] });

  // ── things the JavaScript still answers ──
  back("tail: gws cannot be started", ["tail", DIRECT, "--timeout", "0"], { env: { GCHAT_GWS_BIN: "/nonexistent/gws" } });
  late("tail: gws disappears after resolving the space", ["tail", "Engineering", "--timeout", "0"], {
    env: { GCHAT_GWS_BIN: "./gws-once" },
    files: { "gws-once": `#!/bin/sh\nrm -f ./gws-once\nexec '${kit.FAKE}' "$@"\n` },
    setup: ["chmod +x gws-once"],
    gws: [spacesRule(), messagesRule()],
  });
  // (The JavaScript asks again after Rust has, so these answers repeat.)
  late("tail: a backlog message of an odd shape", ["tail", DIRECT, "-n", "2", ...FAST], { gws: [polls(list({ name: "a", text: 5, createTime: "2026-07-07T10:00:00Z" }, m5))] });
  late("tail: a backlog message with a time in another notation", ["tail", DIRECT, ...FAST], {
    gws: [polls(list({ name: "a", text: "x", createTime: "7 July 2026 10:00 UTC" }), list({ name: "a", text: "x", createTime: "7 July 2026 10:00 UTC" }), END)],
  });
  late("tail: a null message in the first answer", ["tail", DIRECT, "--timeout", "0"], { gws: [messagesRule([m5, null])] });
  late("tail: empty first answer", ["tail", DIRECT, "--timeout", "0"], { gws: [rule(MESSAGES_LIST, {})] });
  late("tail: first answer with messages that is not a list", ["tail", DIRECT, "--timeout", "0"], { gws: [rule(MESSAGES_LIST, json({ messages: 5 }))] });
  late("tail: the answer about me holds a lone surrogate", ["tail", DIRECT, "--timeout", "0", "--exit-on-message"], {
    gws: [rule(PEOPLE_GET, { stdout: '{"metadata":{"sources":[{"type":"PROFILE","id":"\\ud800"}]}}' }), messagesRule()],
  });
  back("tail: no space given", ["tail"], { gws: [messagesRule()] });
  back("tail: two spaces given", ["tail", DIRECT, "Leads", "--timeout", "0"], { gws: [spacesRule(), messagesRule()] });
  back("tail: an interval that is not a number", ["tail", DIRECT, "--timeout", "0", "--interval", "fast"], { gws: [messagesRule()] });
  back("tail: a negative interval", ["tail", DIRECT, "--timeout", "0", "--interval", "-1"], { gws: [messagesRule()] });
  back("tail: an interval with an exponent", ["tail", DIRECT, "--timeout", "0", "--interval", "1e-3"], { gws: [messagesRule()] });
  back("tail: an interval without a leading digit", ["tail", DIRECT, "--timeout", "0", "--interval", ".5"], { gws: [messagesRule()] });
  back("tail: an interval too long for a timer", ["tail", DIRECT, "--timeout", "0", "--interval", "2147484"], { gws: [messagesRule()] });
  back("tail: an interval with seven decimals", ["tail", DIRECT, "--timeout", "0", "--interval", "0.0000001"], { gws: [messagesRule()] });
  back("tail: a timeout without a value", ["tail", DIRECT, "--timeout"], { gws: [polls(list(m5), END)], after: [] });
  back("tail: an empty timeout", ["tail", DIRECT, "--timeout", ""], { gws: [polls(list(m5), END)], after: [] });
  back("tail: --timeout= with nothing", ["tail", DIRECT, "--timeout="], { gws: [polls(list(m5), END)], after: [] });
  back("tail: a timeout starting with a dash", ["tail", DIRECT, "--timeout", "-5"], { gws: [messagesRule()] });
  back("tail: a timeout given twice", ["tail", DIRECT, "--timeout", "0", "--timeout", "0"], { gws: [messagesRule()] });
  back("tail: --exit-on-message=true", ["tail", DIRECT, "--timeout", "0", "--exit-on-message=true"], { gws: [me(), messagesRule()] });
  back("tail: --exit-on-message false", ["tail", DIRECT, "--timeout", "0", "--exit-on-message", "false"], { gws: [me(), messagesRule()] });
  back("tail: --no-exit-on-message", ["tail", DIRECT, "--timeout", "0", "--no-exit-on-message"], { gws: [me(), messagesRule()] });
  back("tail: --exitOnMessage", ["tail", DIRECT, "--timeout", "0", "--exitOnMessage"], { gws: [me(), messagesRule()] });
  back("tail: unknown format", ["tail", DIRECT, "--timeout", "0", "--format", "table"], { gws: [messagesRule()] });
  back("tail: --follow is not an option", ["tail", DIRECT, "--follow"], { gws: [messagesRule()] });
  back("tail: --help", ["tail", "--help"], { gws: [messagesRule()] });
  back("tail: GCHAT_CLI_NO_NATIVE hands it back", ["tail", DIRECT, "--exit-on-message", ...FAST], {
    gws: [me(), polls(list(m5), list(other(1), m5))],
    env: { GCHAT_CLI_NO_NATIVE: "1" },
  });
}
