import { expect, test } from "bun:test";
import { BedrockError } from "../error";
import { nearestSnapshots, withSuggestions } from "./suggestions";

test("suggestions preserve error details and omit data when nothing is close", () => {
  const original = new BedrockError("NOT_FOUND", "Unknown name", "List names first.", "detail", { status: 404 });
  expect(withSuggestions(original, "zzzzzzzz", ["notes"])).toBe(original);
  expect(withSuggestions(original, "noets", ["notes"])).toMatchObject({
    code: "NOT_FOUND", message: "Unknown name", status: 404, detail: "detail",
    hint: "Did you mean 'notes'? List names first.", data: { unknown: "noets", suggestions: ["notes"] },
  });
  expect(withSuggestions(original, "ab", ["abcdef", "abcghi"]).data).toEqual({ unknown: "ab", suggestions: ["abcdef", "abcghi"] });
});

test("snapshots rank by time distance, with typo fallback for invalid dates", () => {
  expect(nearestSnapshots("2026-01-03T00:00:00.000Z", ["2026-01-01T00:00:00.000Z", "2026-01-04T00:00:00.000Z", "invalid"]))
    .toEqual(["2026-01-04T00:00:00.000Z", "2026-01-01T00:00:00.000Z"]);
  expect(nearestSnapshots("zzzzzzzz", ["2026-01-01T00:00:00.000Z"])).toEqual([]);
});
