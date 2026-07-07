import { expect, test, describe } from "bun:test";
import { parseDuration } from "../ts/commands/tail.ts";

describe("parseDuration", () => {
  test("bare number → seconds", () => {
    expect(parseDuration("300")).toBe(300);
    expect(parseDuration("0")).toBe(0);
  });
  test("suffixes", () => {
    expect(parseDuration("90s")).toBe(90);
    expect(parseDuration("30m")).toBe(1800);
    expect(parseDuration("2h")).toBe(7200);
    expect(parseDuration("1d")).toBe(86400);
  });
  test("whitespace tolerated", () => {
    expect(parseDuration(" 5m ")).toBe(300);
  });
  test("invalid throws", () => {
    expect(() => parseDuration("soon")).toThrow(/invalid duration/);
    expect(() => parseDuration("10x")).toThrow(/invalid duration/);
    expect(() => parseDuration("")).toThrow(/invalid duration/);
  });
});
