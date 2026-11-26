// `gchat spaces` (also `rooms`, `ls`): the list, its two formats, the pages
// behind it, and the cache file it always rewrites.
export default function ({ add, back, late, rule, json, apiError, spacesRule, SPACES_LIST, WORLD, eng, leads, dm, group, ja, CALLS, CACHE }) {
  const both = [CALLS, CACHE];
  const list = (spaces, more) => [rule(SPACES_LIST, json({ spaces }, more))];

  // ── the table ──
  add("spaces: table, newest activity first", ["spaces"], { gws: [spacesRule()], after: both });
  add("spaces: rooms is the same command", ["rooms"], { gws: [spacesRule()], after: both });
  add("spaces: ls is the same command", ["ls"], { gws: [spacesRule()], after: both });
  add("spaces: --format table", ["spaces", "--format", "table"], { gws: [spacesRule()] });
  add("spaces: --format=table", ["ls", "--format=table"], { gws: [spacesRule()] });
  add("spaces: none at all", ["spaces"], { gws: [rule(SPACES_LIST, json({}))], after: both });
  add("spaces: an empty list", ["spaces"], { gws: list([]), after: both });
  add("spaces: one direct message", ["spaces"], { gws: list([dm]), after: both });
  add("spaces: columns grow with the longest id and type", ["spaces"], {
    gws: list([
      { name: "spaces/A", displayName: "short id", spaceType: "SPACE", lastActiveTime: "2026-07-01T00:00:00Z" },
      { name: "spaces/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", displayName: "long id", spaceType: "GROUP_CHAT", lastActiveTime: "2026-07-02T00:00:00Z" },
      { name: "spaces/B", displayName: "type unknown to gchat", spaceType: "SPACE_TYPE_UNSPECIFIED", lastActiveTime: "2026-07-03T00:00:00Z" },
    ]),
    after: both,
  });
  add("spaces: narrow columns keep the header width", ["spaces"], { gws: list([{ name: "spaces/A", displayName: "x", spaceType: "DM" }]) });
  add("spaces: type words are replaced once, in order", ["spaces"], {
    gws: list([
      { name: "spaces/1", displayName: "a", spaceType: "SPACE SPACE" },
      { name: "spaces/2", displayName: "b", spaceType: "DIRECT_MESSAGE DIRECT_MESSAGE SPACE" },
      { name: "spaces/3", displayName: "c", spaceType: "MY_SPACE_DIRECT_MESSAGE" },
      { name: "spaces/4", displayName: "d", spaceType: "space" },
      { name: "spaces/5", displayName: "e", spaceType: "" },
      { name: "spaces/6", displayName: "f" },
      { name: "spaces/7", displayName: "g", spaceType: null },
    ]),
    after: both,
  });
  add("spaces: empty and missing names", ["spaces"], {
    gws: list([
      { name: "spaces/E1", displayName: "", spaceType: "SPACE" },
      { name: "spaces/E2", displayName: null, spaceType: "SPACE" },
      { name: "spaces/E3", spaceType: "SPACE" },
      { name: "spaces/E4", displayName: "  padded name  ", spaceType: "SPACE" },
    ]),
    after: both,
  });
  add("spaces: names that are not under spaces/", ["spaces"], {
    gws: list([
      { name: "rooms/R1", displayName: "other prefix", spaceType: "SPACE" },
      { name: "spaces/spaces/S2", displayName: "prefix twice", spaceType: "SPACE" },
      { name: "", displayName: "no name", spaceType: "SPACE" },
      { name: "spaces/", displayName: "only the prefix", spaceType: "SPACE" },
      { name: "xspaces/S5", displayName: "prefix inside", spaceType: "SPACE" },
    ]),
    after: both,
  });
  add("spaces: wide characters count by UTF-16 length", ["spaces"], {
    gws: list([
      { name: "spaces/日本語", displayName: "non-ASCII id", spaceType: "SPACE" },
      { name: "spaces/😀😀", displayName: "emoji id", spaceType: "ルーム" },
      { name: "spaces/abcdef", displayName: "plain", spaceType: "SPACE" },
    ]),
    after: both,
  });

  // ── order ──
  add("spaces: order by last activity, missing last, ties keep their order", ["spaces"], {
    gws: list([
      { name: "spaces/none1", displayName: "no activity, first" },
      { name: "spaces/t2a", displayName: "second, tie a", lastActiveTime: "2026-07-02T00:00:00Z" },
      { name: "spaces/t1", displayName: "oldest", lastActiveTime: "2026-07-01T00:00:00Z" },
      { name: "spaces/t2b", displayName: "second, tie b", lastActiveTime: "2026-07-02T00:00:00Z" },
      { name: "spaces/none2", displayName: "no activity, second", lastActiveTime: null },
      { name: "spaces/t3", displayName: "newest", lastActiveTime: "2026-07-03T00:00:00Z" },
      { name: "spaces/t2c", displayName: "second, tie c", lastActiveTime: "2026-07-02T00:00:00Z" },
    ]),
    after: both,
  });
  add("spaces: order with and without fractions of a second", ["spaces"], {
    gws: list([
      { name: "spaces/f1", displayName: "no fraction", lastActiveTime: "2026-07-07T07:41:50Z" },
      { name: "spaces/f2", displayName: ".5", lastActiveTime: "2026-07-07T07:41:50.5Z" },
      { name: "spaces/f3", displayName: ".123456", lastActiveTime: "2026-07-07T07:41:50.123456Z" },
      { name: "spaces/f4", displayName: ".500", lastActiveTime: "2026-07-07T07:41:50.500Z" },
      { name: "spaces/f5", displayName: ".55", lastActiveTime: "2026-07-07T07:41:50.55Z" },
      { name: "spaces/f6", displayName: "next second", lastActiveTime: "2026-07-07T07:41:51Z" },
      { name: "spaces/f7", displayName: ".000000001", lastActiveTime: "2026-07-07T07:41:50.000000001Z" },
      { name: "spaces/f8", displayName: "previous second .999", lastActiveTime: "2026-07-07T07:41:49.999Z" },
    ]),
  });
  add("spaces: order across years, months and days", ["spaces", "--format", "json"], {
    gws: list([
      { name: "spaces/y1", lastActiveTime: "2019-12-31T23:59:59Z" },
      { name: "spaces/y2", lastActiveTime: "2030-01-01T00:00:00Z" },
      { name: "spaces/y3", lastActiveTime: "2026-10-09T08:07:06Z" },
      { name: "spaces/y4", lastActiveTime: "2026-09-10T08:07:06Z" },
      { name: "spaces/y5", lastActiveTime: "2026-10-09T18:07:06Z" },
    ]),
  });

  // ── JSON ──
  add("spaces: --format json prints what gws returned, sorted", ["spaces", "--format", "json"], { gws: [spacesRule()], after: both });
  add("spaces: --format=json with nothing", ["rooms", "--format=json"], { gws: [rule(SPACES_LIST, json({}))], after: both });
  add("spaces: json keeps fields gchat does not know", ["ls", "--format", "json"], {
    gws: list([{ name: "spaces/X", extra: { deep: [1, 2.5, { z: null }], 3: "three", 1: "one" }, displayName: "x", flag: false, n: 1e21 }]),
    after: both,
  });

  // ── pages ──
  add("spaces: three pages", ["spaces"], {
    gws: [
      rule(SPACES_LIST, [
        json({ spaces: [eng, leads], nextPageToken: "page-2" }),
        json({ spaces: [dm], nextPageToken: 'tok "quoted" \\ back/slash é 日本 😀\n\ttab' }),
        json({ spaces: [group, ja] }),
      ]),
    ],
    after: both,
  });
  add("spaces: a page without spaces in the middle", ["spaces", "--format", "json"], {
    gws: [rule(SPACES_LIST, [json({ nextPageToken: "a" }), json({ spaces: null, nextPageToken: "b" }), json({ spaces: [eng], nextPageToken: "" })])],
  });
  add("spaces: page tokens that are not strings", ["spaces"], {
    gws: [
      rule(SPACES_LIST, [
        json({ spaces: [eng], nextPageToken: 7 }),
        json({ spaces: [leads], nextPageToken: { cursor: [1, 2] } }),
        json({ spaces: [dm], nextPageToken: true }),
        json({ spaces: [group], nextPageToken: 0 }),
      ]),
    ],
  });
  add("spaces: an error on the second page", ["spaces"], {
    gws: [rule(SPACES_LIST, [json({ spaces: [eng], nextPageToken: "p2" }), apiError(500, "Internal error encountered.")])],
    after: both,
  });
  add("spaces: answers that are not objects have no spaces", ["spaces"], { gws: [rule(SPACES_LIST, { stdout: "[1,2]" })], after: both });
  add("spaces: falsy spaces are no spaces", ["spaces"], { gws: [rule(SPACES_LIST, json({ spaces: 0 }))] });

  // ── the cache ──
  add("spaces: rewrites a fresh cache", ["spaces"], { gws: [spacesRule([eng])], cache: { spaces: [{ name: "spaces/OLD", displayName: "old", type: "SPACE" }] }, after: both });
  add("spaces: rewrites a broken cache", ["spaces"], { gws: [spacesRule([eng, dm])], cache: { raw: "{ not json" }, after: both });
  add("spaces: creates only what is missing under HOME", ["spaces"], {
    gws: [spacesRule([dm])],
    setup: ['mkdir -m 755 "$HOME/.config"'],
    after: both,
  });
  add("spaces: keeps the mode of an existing cache file", ["spaces"], {
    gws: [spacesRule([dm])],
    cache: { spaces: [] },
    setup: ['chmod 600 "$HOME/.config/gchat-cli/spaces.json"; chmod 750 "$HOME/.config/gchat-cli"'],
    after: both,
  });
  add("spaces: HOME is normalized like path.join", ["spaces"], {
    gws: [spacesRule([eng])],
    env: { HOME: "./h//x/../" },
    setup: ["mkdir h"],
    after: [CALLS, "cat h/.config/gchat-cli/spaces.json; find h -printf '%M %P\\n' | sort"],
  });
  add("spaces: nothing is cached when gws fails", ["spaces"], { gws: [rule(SPACES_LIST, apiError(403, "Request had insufficient authentication scopes."))], after: both });
  add("spaces: gws error keeps the old cache", ["spaces"], {
    gws: [rule(SPACES_LIST, apiError(503, "The service is currently unavailable."))],
    cache: { spaces: [{ name: "spaces/OLD", displayName: "old", type: "SPACE" }], age: 1000 },
    after: both,
  });

  // ── things the JavaScript still answers ──
  late("spaces: activity time in another notation", ["spaces"], {
    gws: list([
      { name: "spaces/a", displayName: "a", lastActiveTime: "2026-07-07 07:41:50" },
      { name: "spaces/b", displayName: "b", lastActiveTime: "07/08/2026" },
    ]),
    after: both,
  });
  late("spaces: activity time with an offset", ["spaces"], {
    gws: list([
      { name: "spaces/a", displayName: "a", lastActiveTime: "2026-07-07T07:41:50+09:00" },
      { name: "spaces/b", displayName: "b", lastActiveTime: "2026-07-07T07:41:50Z" },
    ]),
    after: both,
  });
  late("spaces: activity time that is a number", ["spaces"], { gws: list([{ name: "spaces/a", lastActiveTime: 5 }, { name: "spaces/b" }]), after: both });
  late("spaces: a space without a name", ["spaces"], { gws: list([{ displayName: "nameless" }, eng]), after: both });
  late("spaces: a space without a name, as json", ["spaces", "--format", "json"], { gws: list([{ displayName: "nameless" }, eng]), after: both });
  late("spaces: a space that is null", ["spaces"], { gws: list([eng, null]), after: both });
  late("spaces: a space that is a string", ["spaces", "--format", "json"], { gws: list(["spaces/x", eng]), after: both });
  late("spaces: a display name that is a number", ["spaces"], { gws: list([{ name: "spaces/a", displayName: 42 }]), after: both });
  late("spaces: a type that is a number", ["spaces"], { gws: list([{ name: "spaces/a", displayName: "a", spaceType: 3 }]), after: both });
  late("spaces: spaces that is a string", ["spaces"], { gws: [rule(SPACES_LIST, json({ spaces: "abc" }))], after: both });
  late("spaces: spaces that is an object", ["spaces"], { gws: [rule(SPACES_LIST, json({ spaces: { 0: eng } }))], after: both });
  late("spaces: empty output from gws", ["spaces"], { gws: [rule(SPACES_LIST, {})], after: both });
  late("spaces: HOME that cannot be written", ["spaces"], { gws: [spacesRule([eng])], env: { HOME: "/proc/gchat-parity-no-such-home" } });
  back("spaces: unknown format", ["spaces", "--format", "text"], { gws: [spacesRule()] });
  back("spaces: --refresh is not an option", ["spaces", "--refresh"], { gws: [spacesRule()] });
  back("spaces: --json is not an option", ["ls", "--json"], { gws: [spacesRule()] });
  back("spaces: unexpected argument", ["spaces", "eng"], { gws: [spacesRule()] });
  back("spaces: --help", ["rooms", "--help"], { gws: [spacesRule()] });
  back("spaces: -n is not an option here", ["spaces", "-n", "5"], { gws: [spacesRule()] });
  back("spaces: an alias that does not exist", ["list"], { gws: [spacesRule()] });
  back("spaces: GCHAT_CLI_NO_NATIVE hands it back", ["spaces"], { gws: [spacesRule()], env: { GCHAT_CLI_NO_NATIVE: "1" }, after: both });
}
