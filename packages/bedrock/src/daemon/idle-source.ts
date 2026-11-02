import { dirname, extname, join, resolve } from "node:path";

// Bun's resource/handle introspection omits live timers. Fail closed on code that
// could own invisible work, including dependencies we cannot audit as local source.
export async function idleSourceSafe(release: string): Promise<boolean> {
  const seen = new Set<string>();
  const scan = async (path: string): Promise<boolean> => {
    if (seen.has(path)) return true;
    seen.add(path);
    const source = await Bun.file(path).text();
    const code = source.replace(/\bBun\.file\b/g, "");
    if (/\b(Bun|setTimeout|setInterval|setImmediate|fetch|WebSocket|Worker|SharedWorker|EventSource|XMLHttpRequest|require|eval|Function|globalThis|global|process|Deno)\b|\bimport\s*\(/.test(code)) return false;
    const transpiler = new Bun.Transpiler({ loader: extname(path) === ".tsx" ? "tsx" : "ts" });
    for (const dependency of transpiler.scanImports(source)) {
      if (dependency.kind !== "import-statement") return false;
      if (["bedrock", "node:path", "path"].includes(dependency.path)) continue;
      if (!dependency.path.startsWith(".")) return false;
      const base = resolve(dirname(path), dependency.path);
      const candidates = [base, ...[".ts", ".tsx", ".js", ".mjs", "/index.ts", "/index.js"].map(suffix => base + suffix)];
      let found = false;
      for (const candidate of candidates) {
        if (!await Bun.file(candidate).exists()) continue;
        if (![".ts", ".tsx", ".js", ".mjs"].includes(extname(candidate))) return false;
        if (!await scan(candidate)) return false;
        found = true;
        break;
      }
      if (!found) return false;
    }
    return true;
  };
  try {
    const bunfig = Bun.file(join(release, "bunfig.toml"));
    if (await bunfig.exists()) {
      const config = Bun.TOML.parse(await bunfig.text()) as any;
      if (JSON.stringify(config) !== JSON.stringify({ serve: { static: { plugins: ["bedrock/bundler"] } } })) return false;
    }
    const tsconfig = Bun.file(join(release, "tsconfig.json"));
    if (await tsconfig.exists()) {
      const config = await tsconfig.json();
      if (config.extends || config.compilerOptions?.paths) return false;
    }
    return await scan(join(release, "pebble.ts"));
  }
  catch { return false; }
}
