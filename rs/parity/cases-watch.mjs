// `gchat watch <spaces..>` is not ported: every case here is handed back, and
// shows that the binary routes the command to the JavaScript unchanged.
//
// A watch tails several spaces at once and never ends, so the cases that run
// one end the way the plain-tail cases do: on a chosen poll the fake gws ends
// the process that called it. Several gws processes run at the same time and
// whichever finishes first is printed first; the fake delays the first answer
// for the second space so that this order is the same on every run.
export default function (kit) {
  const { back, rule, json, apiError, spacesRule, messagesRule, MESSAGES_LIST, m3, m4, m5, CALLS, CACHE } = kit;
  const A = "spaces/AAAAeng1";
  const B = "spaces/AAAAeng2";
  const END = { killParent: "SIGTERM" };
  const list = (messages, more) => json({ messages }, more);
  const inB = (n, text) => ({ name: `${B}/messages/B${n}.M${n}`, text, createTime: `2026-07-07T11:0${n}:00Z`, sender: { name: "users/300000000000000000003" } });
  // A answers at once; B's first answer comes 400 ms later, so A's lines of a
  // round always come before B's. B's third poll ends the run.
  const two = [
    rule(MESSAGES_LIST, [list([m5, m4]), list([m5, m4]), list([{ ...m3, name: `${A}/messages/NEWA.M9` }, m5, m4])], A),
    rule(MESSAGES_LIST, [list([inB(1, "first in leads")], { sleep: 400 }), list([inB(2, "second in leads"), inB(1, "first in leads")]), list([inB(2, "second in leads")]), END], B),
  ];
  const SORTED = "sort gws-calls.jsonl";

  back("watch: two spaces by full name, until stopped", ["watch", A, B, "--interval", "0.3"], { gws: two, after: [SORTED] });
  back("watch: two spaces by display name", ["watch", "Engineering", "Leads", "--interval", "0.3", "-n", "1"], { gws: [spacesRule(), ...two], after: [SORTED, CACHE] });
  back("watch: JSON lines carry the space", ["watch", A, B, "--interval", "0.3", "--format", "json"], { gws: two, after: [SORTED] });
  back("watch: one space", ["watch", `${B}:THREAD`, "--interval=0.05", "--limit=5"], {
    gws: [rule(MESSAGES_LIST, [list([inB(1, "only")]), list([inB(2, "new"), inB(1, "only")]), END])],
  });
  back("watch: no such space", ["watch", "Engineering", "marketing"], { gws: [spacesRule(), messagesRule()], after: [SORTED] });
  back("watch: the first request for a space fails", ["watch", A], { gws: [rule(MESSAGES_LIST, apiError(404, "Space not found."))] });
  back("watch: no spaces given", ["watch"], { gws: [] });
  back("watch: --exit-on-message is not an option here", ["watch", A, "--exit-on-message"], { gws: two });
  back("watch: --timeout is not an option here", ["watch", A, "--timeout", "0"], { gws: two });
  back("watch: --help", ["watch", "--help"], { gws: [] });
}
