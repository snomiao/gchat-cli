// `gchat read <space>`, and with it what read, send, tail and watch share:
// resolving a space argument (with the five-minute cache) and rendering
// messages.
export default function (kit) {
  const { add, back, late, rule, json, apiError, spacesRule, messagesRule, SPACES_LIST, MESSAGES_LIST, WORLD, eng, leads, dm, group, ja, MESSAGES, m1, m2, m3, m4, m5, CALLS, CACHE } = kit;
  const world = [spacesRule(), messagesRule()];
  const cached = (spaces = WORLD, age = 0) => ({
    spaces: spaces.map((s) => ({ name: s.name, displayName: s.displayName ?? "", type: s.spaceType ?? "SPACE" })),
    age,
  });
  const only = (...messages) => [messagesRule(messages)];
  const DIRECT = "spaces/AAAAeng1";

  // ── which space ──
  add("read: by full name, no lookup needed", ["read", DIRECT], { gws: world, after: [CALLS, CACHE] });
  add("read: by bare id, looked up and cached", ["read", "AAAAeng1"], { gws: world, after: [CALLS, CACHE] });
  add("read: by exact display name", ["read", "Engineering"], { gws: world });
  add("read: by part of a display name", ["read", "Leads"], { gws: world });
  add("read: by a non-ASCII display name", ["read", "日本語"], { gws: world });
  add("read: by an emoji in the display name", ["read", "🚀"], { gws: world });
  add("read: display names are case sensitive", ["read", "engineering"], { gws: world });
  add("read: nothing matches", ["read", "marketing"], { gws: world, after: [CALLS, CACHE] });
  add("read: a part that matches two spaces", ["read", "Engineer"], { gws: world });
  add("read: two spaces with the same name", ["read", "Twin"], {
    gws: [spacesRule([{ name: "spaces/T1", displayName: "Twin" }, { name: "spaces/T2", displayName: "Twin" }, { name: "spaces/T3", displayName: "Twins" }])],
  });
  add("read: more than six matches are cut in the message", ["read", "team"], {
    gws: [spacesRule(Array.from({ length: 8 }, (_, i) => ({ name: `spaces/S${i}`, displayName: `team ${i}` })))],
  });
  add("read: an exact name wins over longer names", ["read", "team 1"], {
    gws: [spacesRule([{ name: "spaces/S10", displayName: "team 10" }, { name: "spaces/S1", displayName: "team 1" }]), messagesRule([m5])],
  });
  add("read: an id wins over a display name", ["read", "AAAAeng2"], {
    gws: [spacesRule([{ name: "spaces/OTHER", displayName: "AAAAeng2" }, leads]), messagesRule([m5])],
  });
  add("read: a direct message cannot be found by name", ["read", "direct"], { gws: world });
  add("read: a direct message by id", ["read", "BBBBdm01"], { gws: world });
  add("read: <space>:<thread> reads the whole space", ["read", "Engineering:THR1"], { gws: world });
  add("read: spaces/<id>:<thread>", ["read", `${DIRECT}:THR1`], { gws: world });
  add("read: a trailing colon is part of the name", ["read", "Engineering:"], { gws: world });
  add("read: a URL is not split at its colon", ["read", "https://chat.google.com/room/AAAAeng1"], { gws: world });
  add("read: the last colon splits", ["read", "a:b:c"], { gws: [spacesRule([{ name: "spaces/X", displayName: "a:b" }]), messagesRule([m5])] });
  add("read: spaces/ alone is used as it is", ["read", "spaces/"], { gws: [messagesRule([m5])] });
  add("read: a name with spaces and quotes", ["read", 'say "hi" \\ there'], {
    gws: [spacesRule([{ name: "spaces/Q", displayName: 'we say "hi" \\ there often' }]), messagesRule([m5])],
  });
  add("read: an argument that looks like a number", ["read", "12345"], { gws: [spacesRule([{ name: "spaces/12345", displayName: "numeric id" }]), messagesRule([m5])] });
  add("read: an argument that looks like an exponent", ["read", "1e3"], { gws: [spacesRule([{ name: "spaces/1e3", displayName: "x" }, { name: "spaces/1000", displayName: "y" }]), messagesRule([m5])] });
  add("read: an argument that looks like hex", ["read", "0x10"], { gws: [spacesRule([{ name: "spaces/0x10", displayName: "x" }, { name: "spaces/16", displayName: "y" }]), messagesRule([m5])] });
  add("read: an argument with leading zeros", ["read", "007"], { gws: [spacesRule([{ name: "spaces/007", displayName: "x" }, { name: "spaces/7", displayName: "y" }]), messagesRule([m5])] });
  add("read: an argument like a decimal", ["read", "1.0"], { gws: [spacesRule([{ name: "spaces/1.0", displayName: "x" }, { name: "spaces/1", displayName: "y" }]), messagesRule([m5])] });
  add("read: an argument that is true", ["read", "true"], { gws: [spacesRule([{ name: "spaces/true", displayName: "x" }]), messagesRule([m5])] });
  add("read: an argument with surrounding blanks", ["read", " Engineering "], { gws: world });
  add("read: an argument in quotes", ["read", '"Engineering"'], { gws: world });
  add("read: an argument with an equals sign", ["read", "a=b"], { gws: [spacesRule([{ name: "spaces/X", displayName: "a=b" }]), messagesRule([m5])] });
  add("read: the space list has pages", ["read", "launch"], {
    gws: [rule(SPACES_LIST, [json({ spaces: [eng, leads], nextPageToken: "p2" }), json({ spaces: [dm, group, ja] })]), messagesRule([m5])],
    after: [CALLS, CACHE],
  });

  // ── the cache ──
  add("read: a fresh cache answers without asking gws", ["read", "Engineering"], { gws: [messagesRule()], cache: cached(), after: [CALLS, CACHE] });
  add("read: a cache of 4m50s is still fresh", ["read", "Leads"], { gws: [messagesRule()], cache: cached(WORLD, 290) });
  add("read: a cache of 5m10s is refetched and rewritten", ["read", "Leads"], { gws: world, cache: cached([eng], 310), after: [CALLS, CACHE] });
  add("read: a fresh cache is trusted even when it is wrong", ["read", "Engineering"], { gws: world, cache: cached([{ name: "spaces/STALE", displayName: "Engineering" }]) });
  add("read: nothing in a fresh cache matches", ["read", "Engineering"], { gws: world, cache: cached([dm]) });
  add("read: a full name skips the cache", ["read", DIRECT], { gws: world, cache: cached([dm]), after: [CALLS, CACHE] });
  add("read: a cache that is not JSON is refetched", ["read", "Leads"], { gws: world, cache: { raw: "not json\n" }, after: [CALLS, CACHE] });
  add("read: an empty cache file is refetched", ["read", "Leads"], { gws: world, cache: { raw: "" }, after: [CALLS, CACHE] });
  add("read: a cache without fetched_at is refetched", ["read", "Leads"], { gws: world, cache: { raw: JSON.stringify({ spaces: cached().spaces }) } });
  add("read: a cache with fetched_at null is refetched", ["read", "Leads"], { gws: world, cache: { raw: JSON.stringify({ fetched_at: null, spaces: [] }) } });
  add("read: a cache that is null is refetched", ["read", "Leads"], { gws: world, cache: { raw: "null" } });
  add("read: a cache that is an empty list is refetched", ["read", "Leads"], { gws: world, cache: { raw: "[]" } });
  add("read: a cache that is a number is refetched", ["read", "Leads"], { gws: world, cache: { raw: "5" } });
  add("read: a cache from the future is fresh", ["read", "Leads"], { gws: [messagesRule()], cache: cached(WORLD, -100000) });
  add("read: a cache with a byte-order mark is refetched", ["read", "Leads"], { gws: world, cache: { raw: "﻿" + JSON.stringify({ fetched_at: 9e15, spaces: [] }) } });
  add("read: cache entries may lack a display name", ["read", "BBBBdm01"], {
    gws: [messagesRule([m5])],
    cache: { raw: JSON.stringify({ fetched_at: "__T__", spaces: [{ name: "spaces/BBBBdm01" }, { name: "spaces/N", displayName: null }] }).replace('"__T__"', "__T__") },
  });
  add("read: resolving fails, gws error", ["read", "Engineering"], { gws: [rule(SPACES_LIST, apiError(403, "Request had insufficient authentication scopes."))], after: [CALLS, CACHE] });

  // ── how many ──
  add("read: -n 2 shows the two newest, oldest first", ["read", DIRECT, "-n", "2"], { gws: world });
  add("read: --limit 3", ["read", DIRECT, "--limit", "3"], { gws: world });
  add("read: --limit=1", ["read", DIRECT, "--limit=1"], { gws: world });
  add("read: the option before the space", ["read", "-n", "2", DIRECT], { gws: world });
  add("read: -n 0 asks for one and shows none", ["read", DIRECT, "-n", "0"], { gws: world });
  add("read: a negative limit drops from the end", ["read", DIRECT, "--limit", "-2"], { gws: world });
  add("read: a negative limit past the start", ["read", DIRECT, "-n", "-9"], { gws: world });
  add("read: --limit=-1", ["read", DIRECT, "--limit=-1", "--format=json"], { gws: world });
  add("read: a limit larger than what gws returns", ["read", DIRECT, "-n", "500"], { gws: world });
  add("read: gws returns more than the limit", ["read", DIRECT, "-n", "1"], { gws: world });
  add("read: a nine-digit limit", ["read", DIRECT, "-n", "123456789"], { gws: world });

  // ── the lines ──
  add("read: an empty space", ["read", DIRECT], { gws: only() });
  add("read: no messages field", ["read", DIRECT], { gws: [rule(MESSAGES_LIST, json({}))] });
  add("read: messages null", ["read", DIRECT], { gws: [rule(MESSAGES_LIST, json({ messages: null }))] });
  add("read: an answer that is not an object", ["read", DIRECT], { gws: [rule(MESSAGES_LIST, { stdout: '"text"' })] });
  add("read: local time in Tokyo", ["read", DIRECT], { gws: world, env: { TZ: "Asia/Tokyo" } });
  add("read: local time in New York, summer and winter", ["read", DIRECT], { gws: world, env: { TZ: "America/New_York" } });
  add("read: local time with a half-hour offset", ["read", DIRECT], { gws: world, env: { TZ: "Asia/Kolkata" } });
  add("read: local time west of the date line", ["read", DIRECT], { gws: world, env: { TZ: "Pacific/Pago_Pago" } });
  add("read: local time under an old zone name", ["read", DIRECT], { gws: world, env: { TZ: "US/Pacific" } });
  add("read: local time in the system's zone", ["read", DIRECT], { gws: world, env: { TZ: null } });
  add("read: times around a daylight-saving change", ["read", DIRECT], {
    env: { TZ: "Europe/Berlin" },
    gws: only(
      { name: "spaces/X/messages/A.4", text: "after the autumn change", createTime: "2026-10-25T01:30:00Z" },
      { name: "spaces/X/messages/A.3", text: "before the autumn change", createTime: "2026-10-25T00:30:00Z" },
      { name: "spaces/X/messages/A.2", text: "after the spring change", createTime: "2026-03-29T01:00:00Z" },
      { name: "spaces/X/messages/A.1", text: "before the spring change", createTime: "2026-03-29T00:59:59.999Z" },
    ),
  });
  add("read: times at the edges of minutes, days and years", ["read", DIRECT], {
    gws: only(
      { name: "spaces/X/messages/A.7", text: "last instant of 2026", createTime: "2026-12-31T23:59:59.999999999Z" },
      { name: "spaces/X/messages/A.6", text: "leap day", createTime: "2028-02-29T12:00:00Z" },
      { name: "spaces/X/messages/A.5", text: "offset ahead", createTime: "2026-07-07T00:10:00+05:30" },
      { name: "spaces/X/messages/A.4", text: "offset behind", createTime: "2026-07-07T23:50:00-11:00" },
      { name: "spaces/X/messages/A.3", text: "zero offset written as minus", createTime: "2026-07-07T07:41:50-00:00" },
      { name: "spaces/X/messages/A.2", text: "the epoch", createTime: "1970-01-01T00:00:00Z" },
      { name: "spaces/X/messages/A.1", text: "far ahead", createTime: "2099-12-31T23:59:59Z" },
    ),
  });
  add("read: senders of every kind", ["read", DIRECT], {
    gws: only(
      { name: "spaces/X/messages/A.9", text: "exactly six", createTime: "2026-07-07T00:00:09Z", sender: { name: "users/123456" } },
      { name: "spaces/X/messages/A.8", text: "seven", createTime: "2026-07-07T00:00:08Z", sender: { name: "users/1234567" } },
      { name: "spaces/X/messages/A.7", text: "empty id", createTime: "2026-07-07T00:00:07Z", sender: { name: "users/", type: "BOT" } },
      { name: "spaces/X/messages/A.6", text: "display name that looks like an id", createTime: "2026-07-07T00:00:06Z", sender: { name: "users/1", displayName: "users/abcdefghij", type: "BOT" } },
      { name: "spaces/X/messages/A.5", text: "empty display name", createTime: "2026-07-07T00:00:05Z", sender: { name: "users/555555555", displayName: "" } },
      { name: "spaces/X/messages/A.4", text: "empty sender", createTime: "2026-07-07T00:00:04Z", sender: {} },
      { name: "spaces/X/messages/A.3", text: "null sender", createTime: "2026-07-07T00:00:03Z", sender: null },
      { name: "spaces/X/messages/A.2", text: "type in lower case", createTime: "2026-07-07T00:00:02Z", sender: { name: "users/22222222", type: "bot" } },
      { name: "spaces/X/messages/A.1", text: "emoji in the id", createTime: "2026-07-07T00:00:01Z", sender: { name: "users/ab😀cd😀ef" } },
      { name: "spaces/X/messages/A.0", text: "sender that is a string", createTime: "2026-07-07T00:00:00Z", sender: "users/777" },
    ),
  });
  add("read: text of every kind", ["read", DIRECT], {
    gws: only(
      { name: "spaces/X/messages/A.9", text: "", formattedText: "not used: text is empty, not missing", createTime: "2026-07-07T00:00:09Z" },
      { name: "spaces/X/messages/A.8", text: null, formattedText: "used: text is null", createTime: "2026-07-07T00:00:08Z" },
      { name: "spaces/X/messages/A.7", text: null, formattedText: null, argumentText: null, createTime: "2026-07-07T00:00:07Z" },
      { name: "spaces/X/messages/A.6", text: "\n\n", createTime: "2026-07-07T00:00:06Z" },
      { name: "spaces/X/messages/A.5", text: "  leading and trailing blanks \t ", createTime: "2026-07-07T00:00:05Z" },
      { name: "spaces/X/messages/A.4", text: "a \n　b c \nd﻿\n﻿e\u0085\nf\u000b\n\u000cg", createTime: "2026-07-07T00:00:04Z" },
      { name: "spaces/X/messages/A.3", text: "tabs\tand  double  spaces stay", createTime: "2026-07-07T00:00:03Z" },
      { name: "spaces/X/messages/A.2", text: "carriage\rreturn alone, then\r\nwith a line feed", createTime: "2026-07-07T00:00:02Z" },
      { name: "spaces/X/messages/A.1", text: "<users/123> mentioned *you* `code` 日本語 😀 \\ \"q\"", createTime: "2026-07-07T00:00:01Z" },
    ),
  });
  add("read: threads of every kind", ["read", DIRECT], {
    gws: only(
      { name: "spaces/X/messages/A.9", text: "thread name without a slash", createTime: "2026-07-07T00:00:09Z", thread: { name: "plain" } },
      { name: "spaces/X/messages/A.8", text: "thread name ending in a slash", createTime: "2026-07-07T00:00:08Z", thread: { name: "spaces/X/threads/" } },
      { name: "spaces/X/messages/B.C.D", text: "empty thread name, id with two dots", createTime: "2026-07-07T00:00:07Z", thread: { name: "" } },
      { name: "spaces/X/messages/.E", text: "thread without a name, id starting with a dot", createTime: "2026-07-07T00:00:06Z", thread: {} },
      { name: "noslash", text: "null thread, name without a slash", createTime: "2026-07-07T00:00:05Z", thread: null },
      { name: "", text: "empty name", createTime: "2026-07-07T00:00:04Z" },
      { name: "spaces/X/messages/A.3", text: "thread that is a string", createTime: "2026-07-07T00:00:03Z", thread: "spaces/X/threads/T" },
    ),
  });
  add("read: a message without a time shows undefined", ["read", DIRECT], { gws: only({ name: "spaces/X/messages/A.1", text: "no createTime" }) });
  add("read: thread hints use the space id", ["read", "launch"], {
    gws: [spacesRule(), rule(MESSAGES_LIST, json({ messages: [{ name: "spaces/CCCCgrp1/messages/T9.M1", text: "in the group", createTime: "2026-07-07T00:00:00Z" }] }), "spaces/CCCCgrp1")],
  });

  // ── JSON ──
  add("read: --format json prints the messages as gws returned them", ["read", DIRECT, "--format", "json"], { gws: world });
  add("read: --format=json -n 2", ["read", DIRECT, "--format=json", "-n", "2"], { gws: world });
  add("read: json of an empty space", ["read", DIRECT, "--format", "json"], { gws: only() });
  add("read: json does not look inside the messages", ["read", DIRECT, "--format", "json"], {
    gws: only(null, 5, "text", [1, 2], { name: 7, createTime: "whenever", text: { rich: true } }, { 2: "b", 1: "a", z: 1e21 }),
  });
  add("read: --format text", ["read", DIRECT, "--format", "text", "-n", "1"], { gws: world });

  // ── gws fails ──
  add("read: the space does not exist (404)", ["read", "spaces/NOPE"], { gws: [rule(MESSAGES_LIST, apiError(404, "Space not found."))] });
  add("read: missing read scope", ["read", DIRECT], { gws: [rule(MESSAGES_LIST, apiError(403, "Request had insufficient authentication scopes."))] });
  add("read: gws prints something that is not JSON", ["read", DIRECT], { gws: [rule(MESSAGES_LIST, { stdout: "<html>502 Bad Gateway</html>\n", exit: 0 })] });
  add("read: gws fails without output", ["read", DIRECT], { gws: [rule(MESSAGES_LIST, { exit: 3 })] });

  // ── things the JavaScript still answers ──
  late("read: a time in another notation", ["read", DIRECT], { gws: only({ name: "spaces/X/messages/A.1", text: "x", createTime: "2026-07-07 07:41:50Z" }) });
  late("read: a time without a zone", ["read", DIRECT], { gws: only({ name: "spaces/X/messages/A.1", text: "x", createTime: "2026-07-07T07:41:50" }) });
  late("read: a day past the end of the month", ["read", DIRECT], { gws: only({ name: "spaces/X/messages/A.1", text: "x", createTime: "2026-02-30T00:00:00Z" }) });
  late("read: a time that is not a time", ["read", DIRECT], { gws: only({ name: "spaces/X/messages/A.1", text: "x", createTime: "yesterday" }) });
  late("read: a time before 1970", ["read", DIRECT], { gws: only({ name: "spaces/X/messages/A.1", text: "x", createTime: "1969-12-31T23:59:59Z" }) });
  late("read: a time that is a number", ["read", DIRECT], { gws: only({ name: "spaces/X/messages/A.1", text: "x", createTime: 1783410110000 }) });
  late("read: a time that is null", ["read", DIRECT], { gws: only({ name: "spaces/X/messages/A.1", text: "x", createTime: null }) });
  late("read: text that is a number", ["read", DIRECT], { gws: only({ name: "spaces/X/messages/A.1", text: 42, createTime: "2026-07-07T00:00:00Z" }) });
  late("read: a message without a name or thread", ["read", DIRECT], { gws: only({ text: "x", createTime: "2026-07-07T00:00:00Z" }) });
  late("read: a message that is null", ["read", DIRECT], { gws: only(m5, null) });
  late("read: a sender name that is a number", ["read", DIRECT], { gws: only({ name: "spaces/X/messages/A.1", text: "x", createTime: "2026-07-07T00:00:00Z", sender: { name: 5 } }) });
  late("read: a thread name that is a number", ["read", DIRECT], { gws: only({ name: "spaces/X/messages/A.1", text: "x", createTime: "2026-07-07T00:00:00Z", thread: { name: 5 } }) });
  late("read: messages that is an object", ["read", DIRECT], { gws: [rule(MESSAGES_LIST, json({ messages: { 0: m5 } }))] });
  late("read: messages that is a string", ["read", DIRECT, "--format", "json"], { gws: [rule(MESSAGES_LIST, json({ messages: "abc" }))] });
  late("read: empty output from gws", ["read", DIRECT], { gws: [rule(MESSAGES_LIST, {})] });
  late("read: TZ that is not a zone name", ["read", DIRECT], { gws: world, env: { TZ: "JST-9" } });
  late("read: TZ with a leading colon", ["read", DIRECT], { gws: world, env: { TZ: ":Asia/Tokyo" } });
  late("read: empty TZ", ["read", DIRECT], { gws: world, env: { TZ: "" } });
  late("read: a cache file that is a directory cannot be rewritten", ["read", "Leads"], { gws: world, setup: ['mkdir -p "$HOME/.config/gchat-cli/spaces.json"'] });
  late("read: a cache whose fetched_at is a string", ["read", "Leads"], { gws: world, cache: { raw: JSON.stringify({ fetched_at: "9999999999999", spaces: [] }) } });
  late("read: a fresh cache without spaces", ["read", "Leads"], { gws: world, cache: { raw: JSON.stringify({ fetched_at: 9e15 }) } });
  late("read: a fresh cache with a nameless entry", ["read", "Leads"], { gws: world, cache: { raw: JSON.stringify({ fetched_at: 9e15, spaces: [{ displayName: "Leads" }] }) } });
  back("read: no space given", ["read"], { gws: world });
  back("read: two spaces given", ["read", "Engineering", "Leads"], { gws: world });
  back("read: an empty space argument", ["read", ""], { gws: world });
  back("read: a space argument starting with a dash", ["read", "-team"], { gws: world });
  back("read: a limit that is not a number", ["read", DIRECT, "-n", "many"], { gws: world });
  back("read: a limit with a fraction", ["read", DIRECT, "-n", "2.5"], { gws: world });
  back("read: a limit with an exponent", ["read", DIRECT, "--limit", "1e3"], { gws: world });
  back("read: a limit in hex", ["read", DIRECT, "--limit=0x2"], { gws: world });
  back("read: a limit with leading zeros", ["read", DIRECT, "-n", "02"], { gws: world });
  back("read: a limit of minus zero", ["read", DIRECT, "-n", "-0"], { gws: world });
  back("read: a limit attached to -n", ["read", DIRECT, "-n2"], { gws: world });
  back("read: -n=2", ["read", DIRECT, "-n=2"], { gws: world });
  back("read: a limit without a value", ["read", DIRECT, "--limit"], { gws: world });
  back("read: a limit given twice", ["read", DIRECT, "-n", "1", "--limit", "2"], { gws: world });
  back("read: a ten-digit limit", ["read", DIRECT, "-n", "1234567890"], { gws: world });
  back("read: unknown format", ["read", DIRECT, "--format", "table"], { gws: world });
  back("read: --json is not an option", ["read", DIRECT, "--json"], { gws: world });
  back("read: --help", ["read", "--help"], { gws: world });
  back("read: the space after --", ["read", "--", DIRECT], { gws: world });
  back("read: an option before the command", ["-n", "1", "read", DIRECT], { gws: world });
  back("read: GCHAT_CLI_NO_NATIVE hands it back", ["read", "Engineering"], { gws: world, env: { GCHAT_CLI_NO_NATIVE: "1" }, after: [CALLS, CACHE] });
}
