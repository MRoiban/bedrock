import { expect, test } from "bun:test";
import { hasWalResetBug } from "./sqlite-version";

for (const [version, vulnerable] of [
  ["3.51.2", true], ["3.51.3", false], ["3.44.5", true], ["3.44.6", false],
  ["3.50.6", true], ["3.50.7", false], ["3.52.0", false], ["3.53.4", false],
  ["3.6.23", false], ["3.7.0", true], ["3.45.0", true], ["4.0.0", false], ["unknown", true],
] as const) test(`SQLite ${version}: WAL-reset vulnerable=${vulnerable}`, () => {
  expect(hasWalResetBug(version)).toBe(vulnerable);
});

test("overlapping writers refuse vulnerable and unknown SQLite builds with an upgrade hint", async () => {
  const { assertConcurrentWalSafe } = await import("./sqlite-version");
  const { Database } = await import("bun:sqlite");
  const { spyOn } = await import("bun:test");
  const sqlite = new Database(":memory:");
  const query = spyOn(sqlite, "query");
  try {
    for (const version of ["3.51.2", "unknown"]) {
      query.mockReturnValue({ get: () => ({ version }) } as any);
      expect(() => assertConcurrentWalSafe(sqlite)).toThrow("overlapping pebble writers are unsafe");
    }
    query.mockReturnValue({ get: () => ({ version: "3.53.4" }) } as any);
    expect(() => assertConcurrentWalSafe(sqlite)).not.toThrow();
  } finally { query.mockRestore(); sqlite.close(); }
});
