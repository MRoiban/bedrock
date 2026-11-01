import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Provenance } from "../version";

export const provenanceFile = ".bedrock-provenance.json";
export function parseProvenance(value: string | null): Provenance {
  try {
    const info = JSON.parse(value ?? "null");
    if (typeof info?.commit === "string" && (info.branch === null || typeof info.branch === "string") && typeof info.dirty === "boolean") {
      return { commit: info.commit, branch: info.branch, dirty: info.dirty };
    }
  } catch {}
  return { commit: null, branch: null, dirty: null };
}
// Git allows branch names that HTTP headers cannot carry, and a deploy must never fail over metadata.
export function encodeProvenance(info: Provenance) { return encodeURIComponent(JSON.stringify(info)); }
export function decodeProvenance(value: string | null) {
  try { return parseProvenance(decodeURIComponent(value ?? "null")); }
  catch { return parseProvenance(null); }
}
// Resolve metadata from the selected release so rollback cannot inherit a newer deploy's source.
export function releaseProvenance(release: string): Provenance {
  try { return parseProvenance(readFileSync(join(release, provenanceFile), "utf8")); }
  catch { return parseProvenance(null); }
}
