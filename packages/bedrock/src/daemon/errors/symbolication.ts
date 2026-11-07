import { join } from "node:path";
import { webBuildDirectory, type WebBuild } from "../../runtime/web-artifacts";
import type { OriginalPosition, SourceMap } from "../source-maps";
import { indexMap, indexedPosition, type IndexedMap } from "./map-index";

const cacheLimit = 64 * 1024 ** 2;
export class SourceMapCache {
  private maps = new Map<string, { map: IndexedMap; bytes: number }>();
  bytes = 0;
  constructor(readonly limit = cacheLimit) {}
  get(path: string) {
    const map = this.maps.get(path);
    if (map) { this.maps.delete(path); this.maps.set(path, map); }
    return map?.map;
  }
  put(path: string, map: IndexedMap) {
    const bytes = map.bytes + Buffer.byteLength(path) * 2 + 256;
    if (bytes > this.limit) return;
    const previous = this.maps.get(path);
    if (previous) { this.bytes -= previous.bytes; this.maps.delete(path); }
    while (this.bytes + bytes > this.limit) {
      const oldest = this.maps.entries().next().value!;
      this.bytes -= oldest[1].bytes; this.maps.delete(oldest[0]);
    }
    this.maps.set(path, { map, bytes }); this.bytes += bytes;
  }
}

export class SymbolicationBatch {
  private deadline = performance.now() + 100;
  private remaining = 8 * 1024 ** 2;
  private lookups = new Map<string, Promise<OriginalPosition | null>>();
  private manifests = new Map<string, Promise<WebBuild | null>>();
  private available = () => performance.now() < this.deadline;
  constructor(private cache = new SourceMapCache()) {}
  position(directory: string, release: string, bundle: string, line: number, column: number) {
    const key = JSON.stringify([directory, release, bundle, line, column]);
    const previous = this.lookups.get(key);
    if (previous) return previous;
    if (!this.available() || this.lookups.size >= 256) return Promise.resolve(null);
    const result = this.lookup(directory, release, bundle, line, column).catch(() => null);
    this.lookups.set(key, result); return result;
  }
  private async lookup(directory: string, release: string, bundle: string, line: number, column: number) {
    if (!/^[a-zA-Z0-9_-]+$/.test(release) || !bundle.startsWith("/") || /[\\?#]/.test(bundle) || bundle.split("/").some(part => part === "." || part === "..")) return null;
    const root = join(directory, release, webBuildDirectory);
    let pending = this.manifests.get(root);
    if (!pending) {
      pending = this.manifest(root); this.manifests.set(root, pending);
    }
    const manifest = await pending;
    if (!manifest || !this.available()) return null;
    const path = Object.hasOwn(manifest.maps, bundle) ? manifest.maps[bundle] : undefined;
    if (!path || !path.startsWith("maps/") || /\\/.test(path) || path.split("/").some(part => part === "." || part === "..")) return null;
    const filename = join(root, path);
    let map = this.cache.get(filename);
    if (!map) {
      const file = Bun.file(filename), size = file.size;
      if (!size || size > this.remaining) return null;
      this.remaining -= size;
      const parsed = await file.json() as SourceMap;
      if (!this.available()) return null;
      map = indexMap(parsed, size, this.available, this.cache.limit) ?? undefined;
      if (!map || !this.available()) return null;
      this.cache.put(filename, map);
    }
    return indexedPosition(map, line, column);
  }
  private async manifest(root: string): Promise<WebBuild | null> {
    const file = Bun.file(join(root, "manifest.json")), size = file.size;
    if (!size || size > 1024 ** 2 || size > this.remaining || !this.available()) return null;
    this.remaining -= size;
    return file.json();
  }
}
