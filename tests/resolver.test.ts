import { expect, test, describe } from "bun:test";
import { splitThread } from "../ts/space-resolver.ts";

describe("splitThread", () => {
  test("no colon → whole arg is the space", () => {
    expect(splitThread("Engineering")).toEqual({ spaceArg: "Engineering" });
  });
  test("space:thread", () => {
    expect(splitThread("AAAAxxxx:TTTTyyyy")).toEqual({
      spaceArg: "AAAAxxxx",
      threadId: "TTTTyyyy",
    });
  });
  test("spaces/<id> with internal slash and no colon stays intact", () => {
    expect(splitThread("spaces/AAAAxxxx")).toEqual({ spaceArg: "spaces/AAAAxxxx" });
  });
  test("spaces/<id>:<thread>", () => {
    expect(splitThread("spaces/AAAAxxxx:TTTTyyyy")).toEqual({
      spaceArg: "spaces/AAAAxxxx",
      threadId: "TTTTyyyy",
    });
  });
  test("a tail containing a slash is not treated as a thread id", () => {
    expect(splitThread("https://chat.google.com/room/x")).toEqual({
      spaceArg: "https://chat.google.com/room/x",
    });
  });
  test("trailing colon → no thread", () => {
    expect(splitThread("eng:")).toEqual({ spaceArg: "eng:" });
  });
});
