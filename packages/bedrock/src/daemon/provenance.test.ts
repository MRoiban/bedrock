import { expect, test } from "bun:test";
import { join } from "node:path";
import { tempDirectory } from "../../test/helpers";
import { openDaemonDatabase } from "./db";
import { parseProvenance, provenanceFile, decodeProvenance, encodeProvenance } from "./provenance";

test("old registry rows report unknown provenance and follow release metadata after reopening", async () => {
  const temp = tempDirectory();
  let db: Awaited<ReturnType<typeof openDaemonDatabase>> | undefined;
  try {
    db = await openDaemonDatabase(temp.dir);
    const release = join(temp.dir, "pebbles/old/releases/one");
    db.save({ name: "old", release, previous_release: null, status: "stopped" });
    expect(db.get("old")!.provenance).toEqual({ commit: null, branch: null, dirty: null });
    const provenance = { commit: "a".repeat(40), branch: null, dirty: false };
    await Bun.write(join(release, provenanceFile), JSON.stringify(provenance));
    db.close(); db = await openDaemonDatabase(temp.dir);
    expect(db.list()[0]!.provenance).toEqual(provenance);
    expect(parseProvenance("invalid JSON")).toEqual({ commit: null, branch: null, dirty: null });
    expect(parseProvenance('{"commit":1}')).toEqual({ commit: null, branch: null, dirty: null });
  } finally { db?.close(); temp.cleanup(); }
});

test("provenance survives branch names HTTP headers cannot carry", () => {
  const info = { commit: "abc123", branch: "feat/日本語", dirty: true };
  const header = encodeProvenance(info);
  expect(new Headers({ "x-bedrock-provenance": header }).get("x-bedrock-provenance")).toBe(header);
  expect(decodeProvenance(header)).toEqual(info);
  expect(decodeProvenance("%E0%A4%A")).toEqual({ commit: null, branch: null, dirty: null });
  expect(decodeProvenance(null)).toEqual({ commit: null, branch: null, dirty: null });
});
