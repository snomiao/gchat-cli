import { expect, test, describe } from "bun:test";
import { formatTime, threadIdOf, formatMessage, formatSpacesTable } from "../ts/format.ts";
import type { Message, Space } from "../ts/gws.ts";

describe("formatTime", () => {
  test("ISO → local YYYY-MM-DD HH:MM", () => {
    // Just assert the shape; exact hour depends on TZ.
    expect(formatTime("2026-07-07T07:41:50.142143Z")).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });
  test("garbage passes through", () => {
    expect(formatTime("not-a-date")).toBe("not-a-date");
  });
});

describe("threadIdOf", () => {
  test("from thread.name", () => {
    const m = { name: "spaces/X/messages/AAA.BBB", thread: { name: "spaces/X/threads/TID" } } as Message;
    expect(threadIdOf(m)).toBe("TID");
  });
  test("falls back to message-id prefix", () => {
    const m = { name: "spaces/X/messages/AAA.BBB" } as Message;
    expect(threadIdOf(m)).toBe("AAA");
  });
});

describe("formatMessage", () => {
  const m: Message = {
    name: "spaces/X/messages/TTTTyyyy.J3WthoKatMQ",
    text: "hello\nworld",
    createTime: "2026-07-07T07:41:50Z",
    sender: { name: "users/114836537158851875650", type: "HUMAN" },
    thread: { name: "spaces/X/threads/TTTTyyyy" },
  };
  test("one-line body, short sender, thread hint", () => {
    const out = formatMessage(m, "X");
    expect(out).toContain("user:…875650");
    expect(out).toContain("hello ⏎ world");
    expect(out).toContain("[thread X:TTTTyyyy]");
  });
  test("bot sender", () => {
    const bot = { ...m, sender: { name: "users/999999", type: "BOT" } } as Message;
    expect(formatMessage(bot)).toContain("bot:…999999");
  });
});

describe("formatSpacesTable", () => {
  test("renders id/type/name, DM shown as (direct message)", () => {
    const spaces: Space[] = [
      { name: "spaces/AAAAxxxx", displayName: "Engineering", spaceType: "SPACE" },
      { name: "spaces/9pR5-yAAAAE", spaceType: "DIRECT_MESSAGE" },
    ];
    const out = formatSpacesTable(spaces);
    expect(out).toContain("AAAAxxxx");
    expect(out).toContain("Engineering");
    expect(out).toContain("room");
    expect(out).toContain("DM");
    expect(out).toContain("(direct message)");
  });
});
