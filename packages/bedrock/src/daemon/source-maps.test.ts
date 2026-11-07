import { expect, test } from "bun:test";
import { originalPosition, symbolicate } from "./source-maps";

test("VLQ state spans lines, resets generated columns, respects gaps and names", () => {
  const map = { version: 3, sources: ["a.ts", "b.ts"], names: ["first", "second"], mappings: "AAAAA,K,ECGGC;AACF" };
  expect(originalPosition(map, 1, 1)).toEqual({ source: "a.ts", line: 1, column: 1, function: "first" });
  expect(originalPosition(map, 1, 6)).toBeNull();
  expect(originalPosition(map, 1, 8)).toEqual({ source: "b.ts", line: 4, column: 4, function: "second" });
  expect(originalPosition(map, 2, 1)).toEqual({ source: "b.ts", line: 5, column: 2, function: null });
  expect(originalPosition(map, 3, 1)).toBeNull();
});

test("symbolication refuses event-controlled URLs, traversal and invalid coordinates", async () => {
  for (const [release, bundle, line, column] of [["../x", "/app.js", 1, 1], ["ok", "https://evil/app.js", 1, 1], ["ok", "/../app.js", 1, 1], ["ok", "/app.js", 0, 1], ["ok", "/app.js", 1, NaN]] as const)
    expect(symbolicate("/unused", release, bundle, line, column)).rejects.toMatchObject({ code: "INVALID_SOURCE_POSITION" });
});
