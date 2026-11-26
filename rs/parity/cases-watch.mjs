// `gchat watch <spaces..>`: several tails at once, each line prefixed with
// its space.
//
// A watch never ends, so the cases that run one end the way the plain-tail
// cases do: on a chosen poll the fake gws ends the process that called it.
//
// Several gws processes run at the same time, and whichever finishes first is
// printed first, in both implementations. So that every run has the same
// order, the cases keep the two spaces half a cycle apart: space A is asked
// at once, the first answer for space B is held back 400 ms, and both poll
// every 800 ms. A's polls then fall about 400 ms before and after each of
// B's, however long a gws call takes on the machine. B's second or third
// poll ends the run, again 400 ms away from A's nearest poll, so the record
// of calls is the same every time too. That record is compared sorted: which
// of two calls started in the same instant gets written first is not
// something either implementation decides.
export default function (kit) {
  const { add, back, late, rule, json, apiError, spacesRule, messagesRule, SPACES_LIST, MESSAGES_LIST, WORLD, m3, m4, m5, CACHE } = kit;
  const A = "spaces/AAAAeng1";
  const B = "spaces/AAAAeng2";
  const END = { killParent: "SIGTERM" };
  const HELD = { sleep: 400 };
  const APART = ["--interval", "0.8"];
  const list = (messages, more) => json({ messages }, more);
  const inB = (n, text) => ({ name: `${B}/messages/B${n}.M${n}`, text, createTime: `2026-07-07T11:0${n}:00Z`, sender: { name: "users/300000000000000000003" } });
  const newA = { ...m3, name: `${A}/messages/NEWA.M9` };
  // In order: A's backlog, B's backlog, a new message in B (its first poll),
  // a new message in A (its second poll), and B's second poll ends the run.
  const forA = rule(MESSAGES_LIST, [list([m5, m4]), list([m5, m4]), list([newA, m5, m4])], A);
  const forB = rule(MESSAGES_LIST, [list([inB(1, "first in leads")], HELD), list([inB(2, "second in leads"), inB(1, "first in leads")]), END], B);
  const two = [forA, forB];
  const SORTED = "sort gws-calls.jsonl";
  // For a watch that fails while other gws processes are still starting:
  // those write their line of the record after the command has ended.
  const SETTLED = "sleep 1; sort gws-calls.jsonl";

  add("watch: two spaces by full name, until stopped", ["watch", A, B, ...APART], { gws: two, after: [SORTED] });
  add("watch: two spaces by display name", ["watch", "Engineering", "Leads", ...APART], { gws: [spacesRule(), ...two], after: [SORTED, CACHE] });
  add("watch: -n 1 seeds one message per space", ["watch", A, B, "--interval=0.8", "-n", "1"], { gws: two, after: [SORTED] });
  add("watch: options between the spaces", ["watch", A, "--limit", "5", B, ...APART], { gws: two, after: [SORTED] });
  add("watch: JSON lines carry the space", ["watch", A, B, ...APART, "--format", "json"], { gws: two, after: [SORTED] });
  add("watch: JSON lines for messages that have a space of their own", ["watch", A, B, ...APART, "--format=json"], {
    gws: [
      rule(MESSAGES_LIST, [list([{ name: "a1", space: { name: A }, 7: "seven", text: "x" }]), list([{ name: "a1" }])], A),
      rule(MESSAGES_LIST, [list([{ name: "b1", 2: "two", space: "mine", z: null }], HELD), list([{ name: "b2", text: "new" }, { name: "b1" }]), END], B),
    ],
    after: [SORTED],
  });
  add("watch: the label is the id when a space has no name", ["watch", "BBBBdm01", "launch", ...APART], {
    gws: [
      spacesRule(),
      rule(MESSAGES_LIST, [list([{ name: "spaces/BBBBdm01/messages/D.1", text: "dm", createTime: "2026-07-07T12:00:00Z" }])], "spaces/BBBBdm01"),
      rule(MESSAGES_LIST, [list([{ name: "spaces/CCCCgrp1/messages/G.1", text: "group", createTime: "2026-07-07T12:00:00Z" }], HELD), list([]), END], "spaces/CCCCgrp1"),
    ],
    after: [SORTED, CACHE],
  });
  add("watch: resolved from a fresh cache without asking gws", ["watch", "Engineering", "Leads", ...APART], {
    gws: two,
    cache: { spaces: WORLD.map((s) => ({ name: s.name, displayName: s.displayName ?? "", type: s.spaceType ?? "SPACE" })) },
    after: [SORTED],
  });
  add("watch: one space", ["watch", `${B}:THREAD`, "--interval=0.05", "--limit=5"], {
    gws: [rule(MESSAGES_LIST, [list([inB(1, "only")]), list([inB(2, "new"), inB(1, "only")]), END])],
  });
  add("watch: an empty space next to a busy one", ["watch", A, B, ...APART], {
    gws: [forA, rule(MESSAGES_LIST, [list([], HELD), list([]), END], B)],
    after: [SORTED],
  });
  add("watch: a failed poll in one space does not stop the others", ["watch", A, B, ...APART], {
    gws: [
      rule(MESSAGES_LIST, [list([m5]), apiError(503, "The service is currently unavailable."), list([newA, m5])], A),
      rule(MESSAGES_LIST, [list([inB(1, "first in leads")], HELD), { stdout: "not json" }, list([inB(2, "second in leads"), inB(1, "first in leads")]), END], B),
    ],
    after: [SORTED],
  });

  // ── failures ──
  add("watch: no such space", ["watch", "Engineering", "marketing"], { gws: [spacesRule(), messagesRule()], after: [SETTLED, CACHE] });
  add("watch: no such space, the only one", ["watch", "marketing", "--interval", "1"], { gws: [spacesRule()], after: [SETTLED, CACHE] });
  add("watch: an ambiguous space among full names", ["watch", A, "Engineer", B], { gws: [spacesRule(), ...two], after: [SETTLED] });
  add("watch: the space list fails", ["watch", "Engineering", "Leads"], { gws: [rule(SPACES_LIST, apiError(403, "Request had insufficient authentication scopes."))], after: [SETTLED] });
  add("watch: the first request for the only space fails", ["watch", A], { gws: [rule(MESSAGES_LIST, apiError(404, "Space not found."))], after: [SETTLED] });
  add("watch: the first request for the second space fails after the first printed", ["watch", A, B, ...APART], {
    gws: [rule(MESSAGES_LIST, [list([m5, m4])], A), rule(MESSAGES_LIST, [apiError(404, "Space not found.", HELD)], B)],
    after: [SETTLED],
  });
  add("watch: the first request for the first space fails before the second answers", ["watch", A, B, ...APART], {
    gws: [rule(MESSAGES_LIST, [apiError(403, "Request had insufficient authentication scopes.")], A), rule(MESSAGES_LIST, [list([inB(1, "never printed")], HELD)], B)],
    after: [SETTLED],
  });

  // ── things the JavaScript still answers ──
  back("watch: gws cannot be started", ["watch", A, B], { env: { GCHAT_GWS_BIN: "/nonexistent/gws" } });
  late("watch: a backlog message of an odd shape, in the first space to answer", ["watch", A, B, ...APART], {
    gws: [rule(MESSAGES_LIST, [list([{ name: "a", text: 5, createTime: "2026-07-07T10:00:00Z" }])], A), rule(MESSAGES_LIST, [list([inB(1, "never printed")], HELD)], B)],
    after: [],
  });
  back("watch: no spaces given", ["watch"], { gws: [] });
  back("watch: only options", ["watch", "-n", "3"], { gws: [] });
  back("watch: --exit-on-message is not an option here", ["watch", A, "--exit-on-message"], { gws: two });
  back("watch: --timeout is not an option here", ["watch", A, "--timeout", "0"], { gws: two });
  // yargs turns these into NaN and the watch runs on: the request asks for a
  // page size of null, and a NaN interval polls without pausing.
  const once = [rule(MESSAGES_LIST, [list([m5]), END])];
  back("watch: a limit that is not a number", ["watch", A, "-n", "x", "--interval", "0.05"], { gws: once });
  back("watch: an interval that is not a number", ["watch", A, "--interval", "soon"], {
    gws: once,
    // bun warns about the NaN timer and names its process id.
    normalize: [["\\(node:\\d+\\)", "(node:<PID>)"]],
  });
  back("watch: an empty space argument", ["watch", A, ""], { gws: two });
  back("watch: --help", ["watch", "--help"], { gws: [] });
  back("watch: GCHAT_CLI_NO_NATIVE hands it back", ["watch", A, B, ...APART], { gws: two, env: { GCHAT_CLI_NO_NATIVE: "1" }, after: [SORTED] });
}
