// `gchat send <space[:thread]> <message> [--code X] [--dry-run]`: the first
// call that shows the context and stores the intent, and the second call that
// posts. Nothing is ever posted anywhere: gws is the fake.
export default function (kit) {
  const { add, back, late, code, rule, json, apiError, spacesRule, messagesRule, SPACES_LIST, MESSAGES_LIST, MESSAGES_CREATE, WORLD, eng, dm, MESSAGES, m3, m4, m5, CALLS, CACHE, PENDING, REPO, sq } = kit;
  const both = [CALLS, PENDING];
  const DIRECT = "spaces/AAAAeng1";
  const posted = { name: `${DIRECT}/messages/NEWT.NEWM`, text: "hello", createTime: "2026-07-07T10:00:00Z", thread: { name: `${DIRECT}/threads/NEWT` } };
  const create = (reply = json(posted)) => rule(MESSAGES_CREATE, reply);
  const world = [spacesRule(), messagesRule(), create()];
  const fresh = { spaces: WORLD.map((s) => ({ name: s.name, displayName: s.displayName ?? "", type: s.spaceType ?? "SPACE" })) };

  // ── first call: context, confirm code, pending file ──
  add("send: first call by display name", ["send", "Engineering", "hello"], { gws: world, after: [CALLS, PENDING, CACHE] });
  add("send: first call for a thread reply", ["send", "Engineering:THR1", "hello"], { gws: world, after: both });
  add("send: first call by full name", ["send", DIRECT, "hello"], { gws: world, after: both });
  add("send: first call by full name and thread", ["send", `${DIRECT}:THR9`, "hello there"], { gws: world, after: both });
  add("send: first call by id shows the display name", ["send", "AAAAeng1", "hello"], { gws: world, after: both });
  add("send: first call to a direct message", ["send", "BBBBdm01", "psst"], { gws: world, after: both });
  add("send: first call with a fresh cache", ["send", "Leads", "hello"], { gws: world, cache: fresh, after: both });
  add("send: first call, no such space", ["send", "marketing", "hello"], { gws: world, after: both });
  add("send: first call, ambiguous space", ["send", "Engineer", "hello"], { gws: world, after: both });
  add("send: first call, the space list fails", ["send", "Engineering", "hello"], { gws: [rule(SPACES_LIST, apiError(403, "Request had insufficient authentication scopes."))], after: both });
  add("send: first call, reading the space fails", ["send", "Engineering", "hello"], { gws: [spacesRule(), rule(MESSAGES_LIST, apiError(404, "Space not found."))], after: both });
  add("send: first call, reading prints no JSON", ["send", DIRECT, "hello"], { gws: [rule(MESSAGES_LIST, { stdout: "oops" })], after: both });
  add("send: first call to an empty space", ["send", DIRECT, "hello"], { gws: [messagesRule([])], after: both });
  add("send: first call, one earlier message", ["send", DIRECT, "hello"], { gws: [messagesRule([m5])], after: both });
  add("send: first call, two earlier messages", ["send", DIRECT, "hello"], { gws: [messagesRule([m4, m3])], after: both });
  add("send: first call shows at most three", ["send", DIRECT, "hello"], { gws: [messagesRule(MESSAGES)], after: both });
  add("send: first call in another time zone", ["send", DIRECT, "hello"], { gws: world, env: { TZ: "Asia/Tokyo" } });
  add("send: first call, a message with line breaks and quotes", ["send", DIRECT, 'line one\nline "two" \\ back\tslash\n\n日本語 😀 end'], { gws: world, after: both });
  add("send: first call, a message that looks like a number", ["send", DIRECT, "123"], { gws: world, after: both });
  add("send: first call, a message that looks like an exponent", ["send", DIRECT, "1e3"], { gws: world, after: both });
  add("send: first call, a message that is true", ["send", DIRECT, "true"], { gws: world, after: both });
  add("send: first call, a message with leading zeros", ["send", DIRECT, "007"], { gws: world, after: both });
  add("send: first call, a message of blanks", ["send", DIRECT, "   "], { gws: world, after: both });
  add("send: first call, a message in quotes", ["send", DIRECT, '"quoted"'], { gws: world, after: both });
  add("send: first call, a message with an equals sign", ["send", DIRECT, "a=b --c"], { gws: world, after: both });
  add("send: first call, a long message", ["send", DIRECT, "long ".repeat(400)], { gws: world, after: both });
  add("send: first call with --dry-run still only asks", ["send", DIRECT, "hello", "--dry-run"], { gws: world, after: both });
  add("send: first call, --dry-run before the arguments", ["send", "--dry-run", DIRECT, "hello"], { gws: world, after: both });
  add("send: first call, --dry-run between the arguments", ["send", DIRECT, "--dry-run", "hello"], { gws: world, after: both });
  add("send: first call, a trailing colon is part of the space", ["send", "Engineering:", "hello"], { gws: world, after: both });
  add("send: first call, a thread id with odd characters", ["send", `${DIRECT}:thr "x" é`, "hello"], { gws: world, after: both });
  add("send: first call, a URL as the space", ["send", "https://chat.google.com/room/AAAAeng1", "hello"], { gws: world, after: both });
  add("send: first call again replaces the pending file and keeps its mode", ["send", DIRECT, "hello"], {
    gws: world,
    setup: [`printf '{"old":true}' > tmp/gchat-cli-pending-${code(DIRECT, "hello")}.json`, `chmod 644 tmp/gchat-cli-pending-${code(DIRECT, "hello")}.json`],
    after: both,
  });
  add("send: first call, TMPDIR with a trailing slash", ["send", DIRECT, "hello"], { gws: world, env: { TMPDIR: "tmp/" }, after: both });
  add("send: first call, TMPDIR that needs normalizing", ["send", DIRECT, "hello"], { gws: world, env: { TMPDIR: "./tmp//sub/../" }, after: both });
  add("send: first call, TMP when TMPDIR is empty", ["send", DIRECT, "hello"], {
    gws: world,
    env: { TMPDIR: "", TMP: "tmp2", TEMP: "tmp3" },
    setup: ["mkdir tmp2 tmp3"],
    after: [CALLS, "ls tmp tmp2 tmp3"],
  });
  add("send: first call, TEMP when the others are empty", ["send", DIRECT, "hello"], {
    gws: world,
    env: { TMPDIR: "", TMP: "", TEMP: "tmp3" },
    setup: ["mkdir tmp2 tmp3"],
    after: [CALLS, "ls tmp tmp2 tmp3"],
  });

  // ── second call: the code ──
  const pending = (space, message, age = 0) => ({ pending: { space, message, age } });
  const confirm = (space, message, ...more) => ["send", space, message, "--code", code(space, message), ...more];
  add("send: confirm posts to a new thread", confirm("Engineering", "hello"), { gws: world, ...pending("Engineering", "hello"), after: [CALLS, PENDING, CACHE] });
  add("send: confirm with --code=", ["send", DIRECT, "hello", `--code=${code(DIRECT, "hello")}`], { gws: world, ...pending(DIRECT, "hello"), after: both });
  add("send: confirm with the code first", ["send", "--code", code(DIRECT, "hello"), DIRECT, "hello"], { gws: world, ...pending(DIRECT, "hello"), after: both });
  add("send: confirm with the code between the arguments", ["send", DIRECT, "--code", code(DIRECT, "hello"), "hello"], { gws: world, ...pending(DIRECT, "hello"), after: both });
  add("send: confirm a thread reply", confirm("Engineering:THR1", "hello"), { gws: world, ...pending("Engineering:THR1", "hello"), after: both });
  add("send: confirm a thread reply by full name", confirm(`${DIRECT}:THR1`, "re: hello"), { gws: world, ...pending(`${DIRECT}:THR1`, "re: hello"), after: both });
  add("send: confirm a thread id with odd characters", confirm(`${DIRECT}:thr "x" é`, "hello"), { gws: world, ...pending(`${DIRECT}:thr "x" é`, "hello"), after: both });
  add("send: confirm with a fresh cache", confirm("Leads", "hello"), { gws: world, cache: fresh, ...pending("Leads", "hello"), after: both });
  add("send: confirm a message with line breaks and quotes", confirm(DIRECT, 'line one\nline "two" \\ back\tslash\n\n日本語 😀 end'), {
    gws: world,
    ...pending(DIRECT, 'line one\nline "two" \\ back\tslash\n\n日本語 😀 end'),
    after: both,
  });
  add("send: confirm a message with control characters", confirm(DIRECT, "bell\u0007 esc\u001b del\u007f sep  nbsp "), {
    gws: world,
    ...pending(DIRECT, "bell\u0007 esc\u001b del\u007f sep  nbsp "),
    after: both,
  });
  add("send: confirm after 55 seconds", confirm(DIRECT, "hello"), { gws: world, ...pending(DIRECT, "hello", 55), after: both });
  add("send: confirm what the TypeScript's first call stored", confirm("Engineering:THR1", "from the first call"), {
    gws: world,
    setup: [`bun "$PARITY_REPO/ts/cli.ts" send Engineering:THR1 'from the first call' > first-call.txt`],
    after: [CALLS, PENDING, "cat first-call.txt"],
  });
  add("send: the reply hint uses the thread gws returned", confirm(DIRECT, "hello"), {
    gws: [create(json({ name: `${DIRECT}/messages/AAA.BBB`, thread: { name: "spaces/OTHER/threads/T-from-gws" } }))],
    ...pending(DIRECT, "hello"),
    after: both,
  });
  add("send: the reply hint falls back to the message id", confirm(DIRECT, "hello"), {
    gws: [create(json({ name: `${DIRECT}/messages/THREADPART.MSGPART` }))],
    ...pending(DIRECT, "hello"),
  });
  add("send: the reply hint from an id without a dot", confirm(DIRECT, "hello"), { gws: [create(json({ name: `${DIRECT}/messages/NODOT`, thread: {} }))], ...pending(DIRECT, "hello") });
  add("send: the reply hint from an empty thread name", confirm(DIRECT, "hello"), { gws: [create(json({ name: "M.1", thread: { name: "" } }))], ...pending(DIRECT, "hello") });
  add("send: gws answers the post with a failing exit but valid JSON", confirm(DIRECT, "hello"), {
    gws: [create(json(posted, { exit: 1, stderr: "warning: slow\n" }))],
    ...pending(DIRECT, "hello"),
    after: both,
  });

  // ── second call: --dry-run ──
  add("send: confirm with --dry-run sends nothing", confirm("Engineering", "hello", "--dry-run"), { gws: world, ...pending("Engineering", "hello"), after: both });
  add("send: --dry-run thread reply", confirm("Engineering:THR1", "hello", "--dry-run"), { gws: world, ...pending("Engineering:THR1", "hello"), after: both });
  add("send: --dry-run before everything", ["send", "--dry-run", DIRECT, "hello", "--code", code(DIRECT, "hello")], { gws: world, ...pending(DIRECT, "hello"), after: both });
  add("send: --dry-run does not read what gws answers", confirm(DIRECT, "hello", "--dry-run"), {
    gws: [create(json({ dry_run: true, method: "POST", body: { text: "hello" } }))],
    ...pending(DIRECT, "hello"),
    after: both,
  });
  add("send: --dry-run with empty output", confirm(DIRECT, "hello", "--dry-run"), { gws: [create({})], ...pending(DIRECT, "hello"), after: both });
  add("send: --dry-run that gws rejects", confirm(DIRECT, "hello", "--dry-run"), {
    gws: [create(apiError(400, "Invalid JSON payload received."))],
    ...pending(DIRECT, "hello"),
    after: both,
  });

  // ── second call: refusals ──
  add("send: wrong code", ["send", DIRECT, "hello", "--code", "deadbeef"], { gws: world, ...pending(DIRECT, "hello"), after: both });
  add("send: wrong code, nothing pending", ["send", DIRECT, "hello", "--code=deadbeef"], { gws: world, after: both });
  add("send: the code of another message", ["send", DIRECT, "hello!", "--code", code(DIRECT, "hello")], { gws: world, ...pending(DIRECT, "hello"), after: both });
  add("send: the code of another thread", ["send", `${DIRECT}:T2`, "hello", "--code", code(`${DIRECT}:T1`, "hello")], { gws: world, ...pending(`${DIRECT}:T1`, "hello"), after: both });
  add("send: the same space spelled differently needs its own code", ["send", "AAAAeng1", "hello", "--code", code(DIRECT, "hello")], { gws: world, ...pending(DIRECT, "hello"), after: both });
  add("send: a code that looks like a number", ["send", DIRECT, "hello", "--code", "12345678"], { gws: world, after: both });
  add("send: a code that looks like an exponent", ["send", DIRECT, "hello", "--code", "1e5"], { gws: world, after: both });
  add("send: a code in upper case", ["send", DIRECT, "hello", "--code", code(DIRECT, "hello").toUpperCase() + "X"], { gws: world, ...pending(DIRECT, "hello"), after: both });
  add("send: right code, nothing pending", confirm(DIRECT, "hello"), { gws: world, after: both });
  add("send: right code, pending expired after 70 seconds", confirm(DIRECT, "hello"), { gws: world, ...pending(DIRECT, "hello", 70), after: both });
  add("send: right code, pending long expired", confirm(DIRECT, "hello", "--dry-run"), { gws: world, ...pending(DIRECT, "hello", 86400), after: both });
  add("send: a pending file without a time never expires", confirm(DIRECT, "hello"), {
    gws: world,
    pending: { space: DIRECT, message: "hello", raw: '{"space_arg":"whatever","message":"is not read"}' },
    after: both,
  });
  add("send: a pending file from the future", confirm(DIRECT, "hello"), { gws: world, ...pending(DIRECT, "hello", -3600), after: both });
  add("send: a pending file that is an empty object", confirm(DIRECT, "hello"), { gws: world, pending: { space: DIRECT, message: "hello", raw: "{}" }, after: both });
  add("send: a pending file that is a list", confirm(DIRECT, "hello"), { gws: world, pending: { space: DIRECT, message: "hello", raw: "[1]" }, after: both });

  // ── second call: failures keep the pending file ──
  add("send: confirm without the send scope, exit 3", confirm(DIRECT, "hello"), {
    gws: [create(apiError(403, "Request had insufficient authentication scopes."))],
    ...pending(DIRECT, "hello"),
    after: both,
  });
  add("send: confirm, space not found (404)", confirm(DIRECT, "hello"), { gws: [create(apiError(404, "Space not found."))], ...pending(DIRECT, "hello"), after: both });
  add("send: confirm, 403 that is not about scopes", confirm(DIRECT, "hello"), { gws: [create(apiError(403, "The caller does not have permission"))], ...pending(DIRECT, "hello"), after: both });
  add("send: confirm, gws prints no JSON", confirm(DIRECT, "hello"), { gws: [create({ stdout: "Sent!\n" })], ...pending(DIRECT, "hello"), after: both });
  add("send: confirm, gws fails without output", confirm(DIRECT, "hello"), { gws: [create({ exit: 9 })], ...pending(DIRECT, "hello"), after: both });
  add("send: confirm, no such space", confirm("marketing", "hello"), { gws: world, ...pending("marketing", "hello"), after: both });
  add("send: confirm, ambiguous space", confirm("Engineer", "hello"), { gws: world, ...pending("Engineer", "hello"), after: both });
  add("send: confirm, the space list fails", confirm("Engineering", "hello"), { gws: [rule(SPACES_LIST, apiError(500, "Internal error"))], ...pending("Engineering", "hello"), after: both });

  // ── after the post, what gws answered is odd ──
  // The message is out, so nothing can be handed back any more: Rust prints
  // the text bun prints for the TypeScript's failure here.
  add("send: posted, gws answers nothing", confirm(DIRECT, "hello"), { gws: [create({})], ...pending(DIRECT, "hello"), after: both });
  add("send: posted, gws answers null", confirm(DIRECT, "hello"), { gws: [create({ stdout: "null" })], ...pending(DIRECT, "hello"), after: both });
  add("send: posted, the answer has no name", confirm(DIRECT, "hello"), { gws: [create(json({ text: "hello" }))], ...pending(DIRECT, "hello"), after: both });
  add("send: posted, the answer is a number", confirm(DIRECT, "hello"), { gws: [create({ stdout: "200" })], ...pending(DIRECT, "hello"), after: both });
  add("send: posted, the name is null", confirm(DIRECT, "hello"), { gws: [create(json({ name: null }))], ...pending(DIRECT, "hello"), after: both });
  add("send: posted, the name is a number", confirm(DIRECT, "hello"), { gws: [create(json({ name: 12 }))], ...pending(DIRECT, "hello"), after: both });
  add("send: posted, the thread name is a number", confirm(DIRECT, "hello"), { gws: [create(json({ name: "A.B", thread: { name: 12 } }))], ...pending(DIRECT, "hello"), after: both });
  add("send: posted, the thread name is true", confirm(DIRECT, "hello"), { gws: [create(json({ name: "A.B", thread: { name: true } }))], ...pending(DIRECT, "hello"), after: both });
  add("send: posted, the thread name is an object", confirm(DIRECT, "hello"), { gws: [create(json({ name: "A.B", thread: { name: { id: 1 } } }))], ...pending(DIRECT, "hello"), after: both });
  add("send: posted, the thread name is a list", confirm(DIRECT, "hello"), {
    gws: [create(json({ name: "A.B", thread: { name: ["a", "/", "b", null, "/", "c", 1, [2, 3]] } }))],
    ...pending(DIRECT, "hello"),
    after: both,
  });
  add("send: posted, the name is a list", confirm(DIRECT, "hello"), { gws: [create(json({ name: ["x", "/", "T", "U", ".", "M"] }))], ...pending(DIRECT, "hello"), after: both });
  add("send: posted, the name is a list without a dot", confirm(DIRECT, "hello"), { gws: [create(json({ name: ["T", "U"], thread: { name: [] } }))], ...pending(DIRECT, "hello"), after: both });
  add("send: posted, the answer holds a lone surrogate", confirm(DIRECT, "hello"), {
    gws: [create({ stdout: '{"name":"spaces/X/messages/T\\ud800.M","text":"x"}' })],
    ...pending(DIRECT, "hello"),
    after: both,
  });
  add("send: posted, then the pending file is already gone", confirm(DIRECT, "hello"), {
    gws: [create(json(posted, { rm: [`tmp/gchat-cli-pending-${code(DIRECT, "hello")}.json`] }))],
    ...pending(DIRECT, "hello"),
    after: both,
  });

  // ── things the JavaScript still answers ──
  back("send: gws cannot be started, first call", ["send", DIRECT, "hello"], { env: { GCHAT_GWS_BIN: "/nonexistent/gws" }, after: both });
  back("send: gws cannot be started, confirm", confirm(DIRECT, "hello"), { env: { GCHAT_GWS_BIN: "/nonexistent/gws" }, ...pending(DIRECT, "hello"), after: both });
  late("send: first call, the temp directory does not exist", ["send", DIRECT, "hello"], { gws: world, env: { TMPDIR: "no-such-dir" }, after: both });
  late("send: first call, an earlier message of an odd shape", ["send", DIRECT, "hello"], {
    gws: [messagesRule([{ name: "spaces/X/messages/A.1", text: 5, createTime: "2026-07-07T00:00:00Z" }])],
    after: both,
  });
  late("send: first call, an earlier message with an odd time", ["send", DIRECT, "hello"], {
    gws: [messagesRule([{ name: "spaces/X/messages/A.1", text: "x", createTime: "last week" }])],
    after: both,
  });
  late("send: first call, messages that is not a list", ["send", DIRECT, "hello"], { gws: [rule(MESSAGES_LIST, json({ messages: { a: 1 } }))], after: both });
  late("send: first call, reading returns nothing at all", ["send", DIRECT, "hello"], { gws: [rule(MESSAGES_LIST, {})], after: both });
  late("send: first call, the space list has a nameless space", ["send", "Engineering", "hello"], { gws: [spacesRule([{ displayName: "Engineering" }])], after: both });
  back("send: a pending file that is not JSON", confirm(DIRECT, "hello"), { gws: world, pending: { space: DIRECT, message: "hello", raw: "garbage" }, after: both });
  back("send: an empty pending file", confirm(DIRECT, "hello"), { gws: world, pending: { space: DIRECT, message: "hello", raw: "" }, after: both });
  back("send: a pending file that is null", confirm(DIRECT, "hello"), { gws: world, pending: { space: DIRECT, message: "hello", raw: "null" }, after: both });
  back("send: a pending file whose time is a string", confirm(DIRECT, "hello"), {
    gws: world,
    pending: { space: DIRECT, message: "hello", raw: '{"created_at":"1"}' },
    after: both,
  });
  back("send: a pending file that is a directory", confirm(DIRECT, "hello"), {
    gws: world,
    setup: [`mkdir tmp/gchat-cli-pending-${code(DIRECT, "hello")}.json`],
    after: [CALLS, "ls -a tmp"],
  });
  late("send: confirm, the space list has a nameless space", confirm("Engineering", "hello"), {
    gws: [spacesRule([{ displayName: "Engineering" }]), create()],
    ...pending("Engineering", "hello"),
    after: both,
  });
  back("send: no message", ["send", "Engineering"], { gws: world, after: both });
  back("send: no arguments", ["send"], { gws: world, after: both });
  back("send: three arguments", ["send", "Engineering", "hello", "world"], { gws: world, after: both });
  back("send: an empty message", ["send", DIRECT, ""], { gws: world, after: both });
  back("send: a message starting with a dash", ["send", DIRECT, "-1"], { gws: world, after: both });
  back("send: a message that is a dash", ["send", DIRECT, "-"], { gws: world, after: both });
  back("send: the message after --", ["send", DIRECT, "--", "--not-an-option"], { gws: world, after: both });
  back("send: --code without a value", ["send", DIRECT, "hello", "--code"], { gws: world, after: both });
  back("send: --code= with nothing", ["send", DIRECT, "hello", "--code="], { gws: world, after: both });
  back("send: an empty code", ["send", DIRECT, "hello", "--code", ""], { gws: world, after: both });
  back("send: a code in quotes", ["send", DIRECT, "hello", `--code="${code(DIRECT, "hello")}"`], { gws: world, ...pending(DIRECT, "hello"), after: both });
  back("send: a code starting with a dash", ["send", DIRECT, "hello", "--code", "-abc"], { gws: world, after: both });
  back("send: the code given twice", ["send", DIRECT, "hello", "--code", code(DIRECT, "hello"), "--code", code(DIRECT, "hello")], { gws: world, ...pending(DIRECT, "hello"), after: both });
  back("send: --dry-run=true", confirm(DIRECT, "hello", "--dry-run=true"), { gws: world, ...pending(DIRECT, "hello"), after: both });
  back("send: --dry-run false", confirm(DIRECT, "hello", "--dry-run", "false"), { gws: world, ...pending(DIRECT, "hello"), after: both });
  back("send: --no-dry-run", confirm(DIRECT, "hello", "--no-dry-run"), { gws: world, ...pending(DIRECT, "hello"), after: both });
  back("send: --dryRun", confirm(DIRECT, "hello", "--dryRun"), { gws: world, ...pending(DIRECT, "hello"), after: both });
  back("send: --dry-run given twice", confirm(DIRECT, "hello", "--dry-run", "--dry-run"), { gws: world, ...pending(DIRECT, "hello"), after: both });
  back("send: --dry-run followed by a message that is true", ["send", DIRECT, "--dry-run", "true"], { gws: world, after: both });
  back("send: unknown option", ["send", DIRECT, "hello", "--thread", "T1"], { gws: world, after: both });
  back("send: --help", ["send", "--help"], { gws: world, after: both });
  back("send: GCHAT_CLI_NO_NATIVE hands the first call back", ["send", "Engineering", "hello"], { gws: world, env: { GCHAT_CLI_NO_NATIVE: "1" }, after: both });
  back("send: GCHAT_CLI_NO_NATIVE hands the confirm back", confirm("Engineering", "hello"), {
    gws: world,
    env: { GCHAT_CLI_NO_NATIVE: "1" },
    ...pending("Engineering", "hello"),
    after: both,
  });
}
