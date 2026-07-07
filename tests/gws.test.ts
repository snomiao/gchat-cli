import { expect, test, describe, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gwsJson, GwsError, listMessages } from "../ts/gws.ts";

// A fake `gws` that reproduces the real one's behavior: it always prints a
// keyring noise line to stderr, then emits a canned JSON payload on stdout and
// exits with a chosen code. The payload + exit code are selected by argv so a
// single script can stand in for several endpoints.
let dir: string;
let fakeBin: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "gchat-fake-gws-"));
  fakeBin = join(dir, "fake-gws");
  const script = `#!/usr/bin/env bash
echo "Using keyring backend: keyring" >&2
case "$*" in
  *SCOPEERR*)
    echo "error[api]: Request had insufficient authentication scopes." >&2
    echo '{"error":{"code":403,"message":"Request had insufficient authentication scopes.","reason":"unknown"}}'
    exit 1 ;;
  *messages\\ list*)
    echo '{"messages":[{"name":"spaces/X/messages/AAA.BBB","text":"hi","createTime":"2026-07-07T07:41:50Z","thread":{"name":"spaces/X/threads/AAA"}}]}'
    exit 0 ;;
  *EMPTY*)
    echo '{}'
    exit 0 ;;
  *BADJSON*)
    echo 'not json at all'
    exit 1 ;;
  *)
    echo '{"ok":true}'
    exit 0 ;;
esac
`;
  writeFileSync(fakeBin, script);
  chmodSync(fakeBin, 0o755);
  process.env.GCHAT_GWS_BIN = fakeBin;
});

afterAll(() => {
  delete process.env.GCHAT_GWS_BIN;
  rmSync(dir, { recursive: true, force: true });
});

describe("gwsJson", () => {
  test("parses stdout JSON, ignores keyring stderr noise", async () => {
    const res = await gwsJson<{ ok: boolean }>(["whatever"]);
    expect(res.ok).toBe(true);
  });

  test("empty object", async () => {
    expect(await gwsJson<Record<string, unknown>>(["EMPTY"])).toEqual({});
  });

  test("403 error envelope → GwsError.isScope", async () => {
    try {
      await gwsJson(["SCOPEERR"]);
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(GwsError);
      expect((e as GwsError).code).toBe(403);
      expect((e as GwsError).isScope).toBe(true);
    }
  });

  test("non-JSON stdout on failure surfaces stderr", async () => {
    try {
      await gwsJson(["BADJSON"]);
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(GwsError);
      // BADJSON path exits non-zero with unparseable stdout → surface the body.
      expect((e as GwsError).message).toContain("not json at all");
    }
  });
});

describe("listMessages", () => {
  test("returns parsed messages array", async () => {
    const msgs = await listMessages("spaces/X", 5);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.text).toBe("hi");
    expect(msgs[0]!.thread!.name).toBe("spaces/X/threads/AAA");
  });
});
