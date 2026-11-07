import { mappingValues, type SourceMap, type OriginalPosition } from "../source-maps";

export interface IndexedMap { map: SourceMap; positions: Float64Array; bytes: number }
// Budget checks also cover dense single-line maps, not just the number of frames.
export function indexMap(map: SourceMap, bytes: number, available: () => boolean, limit = 64 * 1024 ** 2): IndexedMap | null {
  if (map.version !== 3 || !Array.isArray(map.sources) || !Array.isArray(map.names) || typeof map.mappings !== "string") throw new Error("Invalid source map");
  let segments = 0;
  for (let i = 0; i < map.mappings.length; i++) {
    if (i % 4096 === 0 && !available()) return null;
    if (map.mappings[i] !== ";" && map.mappings[i] !== "," && (i === 0 || /[;,]/.test(map.mappings[i - 1]!))) segments++;
  }
  const retainedBytes = bytes * 2 + (map.sources.length + map.names.length) * 32;
  if (retainedBytes + segments * 48 > limit) return null;
  const positions = new Float64Array(segments * 6);
  let source = 0, line = 0, column = 0, name = 0, generatedLine = 1, generatedColumn = 0, offset = 0, start = 0;
  for (let i = 0; i <= map.mappings.length; i++) {
    if (i % 4096 === 0 && !available()) return null;
    const char = map.mappings[i];
    if (i !== map.mappings.length && char !== "," && char !== ";") continue;
    if (i > start) {
      if (i - start > 64) throw new Error("Invalid mapping segment");
      const delta = mappingValues(map.mappings.slice(start, i));
      if (![1, 4, 5].includes(delta.length)) throw new Error("Invalid mapping segment");
      generatedColumn += delta[0]!;
      if (delta.length > 1) {
        source += delta[1]!; line += delta[2]!; column += delta[3]!;
        if (delta.length === 5) name += delta[4]!;
        if (source < 0 || source >= map.sources.length || line < 0 || column < 0) throw new Error("Invalid source position");
      }
      if (!Number.isSafeInteger(generatedColumn) || generatedColumn < 0 || (offset && positions[offset - 6] === generatedLine && positions[offset - 5]! > generatedColumn)) throw new Error("Invalid generated position");
      positions.set([generatedLine, generatedColumn, delta.length > 1 ? source : -1, line, column, delta.length === 5 ? name : -1], offset);
      offset += 6;
    }
    if (char === ";") { generatedLine++; generatedColumn = 0; }
    start = i + 1;
  }
  // sourcesContent can be large and is never needed to map a frame.
  const retained = { version: 3, sources: map.sources, names: map.names, mappings: "", ...(map.sourceRoot ? { sourceRoot: map.sourceRoot } : {}) };
  return { map: retained, positions, bytes: retainedBytes + positions.byteLength };
}

export function indexedPosition({ map, positions }: IndexedMap, line: number, column: number): OriginalPosition | null {
  let low = 0, high = positions.length / 6;
  while (low < high) {
    const mid = Math.floor((low + high) / 2), offset = mid * 6;
    if (positions[offset]! < line || (positions[offset] === line && positions[offset + 1]! <= column - 1)) low = mid + 1;
    else high = mid;
  }
  const offset = (low - 1) * 6, source = positions[offset + 2];
  if (!low || positions[offset] !== line || source === undefined || source < 0) return null;
  const name = positions[offset + 5]!;
  return { source: (map.sourceRoot ? map.sourceRoot.replace(/\/$/, "") + "/" : "") + map.sources[source]!,
    line: positions[offset + 3]! + 1, column: positions[offset + 4]! + 1, function: name < 0 ? null : map.names[name] ?? null };
}
