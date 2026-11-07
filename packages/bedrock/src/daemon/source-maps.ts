import { join } from "node:path";
import { BedrockError } from "../error";
import { webBuildDirectory, type WebBuild } from "../runtime/web-artifacts";

interface SourceMap { version: number; sources: string[]; sourceRoot?: string; names: string[]; mappings: string }
export interface OriginalPosition { source: string; line: number; column: number; function: string | null }
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function values(segment: string) {
  const result: number[] = [];
  let value = 0, shift = 0;
  for (const char of segment) {
    const digit = alphabet.indexOf(char);
    if (digit < 0 || shift > 48) throw new Error("Invalid VLQ mapping");
    value += (digit & 31) * 2 ** shift;
    if (digit & 32) shift += 5;
    else {
      result.push(value % 2 ? -Math.floor(value / 2) : value / 2);
      value = shift = 0;
    }
  }
  if (shift) throw new Error("Truncated VLQ mapping");
  return result;
}

// Lines and columns at this boundary are both one-based, like browser stack frames.
export function originalPosition(map: SourceMap, line: number, column: number): OriginalPosition | null {
  if (map.version !== 3 || !Array.isArray(map.sources) || !Array.isArray(map.names) || typeof map.mappings !== "string") throw new Error("Expected a version 3 source map");
  let source = 0, originalLine = 0, originalColumn = 0, name = 0;
  let generatedLine = 1;
  for (const mappings of map.mappings.split(";")) {
    let generatedColumn = 0;
    let found: OriginalPosition | null = null;
    for (const segment of mappings.split(",")) {
      if (!segment) continue;
      const delta = values(segment);
      if (![1, 4, 5].includes(delta.length)) throw new Error("Invalid mapping segment");
      generatedColumn += delta[0]!;
      if (generatedLine === line && generatedColumn > column - 1) return found;
      if (delta.length === 1) { found = null; continue; }
      source += delta[1]!; originalLine += delta[2]!; originalColumn += delta[3]!;
      if (delta.length === 5) name += delta[4]!;
      if (source < 0 || source >= map.sources.length || originalLine < 0 || originalColumn < 0) throw new Error("Invalid source position");
      if (generatedLine === line) found = {
        source: (map.sourceRoot ? map.sourceRoot.replace(/\/$/, "") + "/" : "") + map.sources[source]!, line: originalLine + 1, column: originalColumn + 1,
        function: delta.length === 5 ? map.names[name] ?? null : null,
      };
    }
    if (generatedLine++ === line) return found;
  }
  return null;
}

// No event-controlled URLs or paths are opened: only exact manifest entries in retained releases.
export async function symbolicate(releasesDirectory: string, releaseId: string, bundle: string, line: number, column: number): Promise<OriginalPosition | null> {
  if (!/^[a-zA-Z0-9_-]+$/.test(releaseId) || !bundle.startsWith("/") || /[\\\\?#]/.test(bundle) || bundle.split("/").some(part => part === "." || part === "..") || !Number.isSafeInteger(line) || line < 1 || !Number.isSafeInteger(column) || column < 1)
    throw new BedrockError("INVALID_SOURCE_POSITION", "Invalid release, bundle path or source position.", "Use an exact release id, an absolute bundle pathname, and one-based line/column numbers.");
  const root = join(releasesDirectory, releaseId, webBuildDirectory);
  const manifestFile = Bun.file(join(root, "manifest.json"));
  if (!await manifestFile.exists()) return null;
  try {
    const manifest = await manifestFile.json() as WebBuild;
    const path = Object.hasOwn(manifest.maps, bundle) ? manifest.maps[bundle] : undefined;
    if (!path) return null;
    if (!path.startsWith("maps/") || /[\\\\]/.test(path) || path.split("/").some(part => part === ".." || part === ".")) throw new Error("Invalid private map path");
    return originalPosition(await Bun.file(join(root, path)).json(), line, column);
  } catch (error) {
    throw new BedrockError("SOURCE_MAP_INVALID", `Cannot read private source map: ${error instanceof Error ? error.message : error}`,
      "Redeploy this release to regenerate its private browser artifacts.");
  }
}
