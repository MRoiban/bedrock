import { mkdir, rm, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import type { BunPlugin } from "bun";
import { BedrockError } from "../error";
import { buildStatic } from "./web-static-build";
import singleReact from "./bundler";
import { loadPebble } from "./load";
import { webBuildDirectory, type WebBuild } from "./web-artifacts";

async function plugins(dir: string): Promise<BunPlugin[]> {
  const config = Bun.file(join(dir, "bunfig.toml"));
  if (!await config.exists()) return [singleReact];
  const settings = Bun.TOML.parse(await config.text()) as { serve?: { static?: { plugins?: string[] } } };
  return Promise.all((settings.serve?.static?.plugins ?? []).map(async name => {
    const path = Bun.resolveSync(name.startsWith(".") ? resolve(dir, name) : name, dir);
    return (await import(path)).default as BunPlugin;
  }));
}

export async function buildWeb(dir: string) {
  const output = join(dir, webBuildDirectory);
  // An uploaded build is never trusted as the artifact for a new release.
  await rm(output, { recursive: true, force: true });
  const pebble = await loadPebble(dir);
  if (!pebble.web) return;
  await mkdir(join(output, "maps"), { recursive: true, mode: 0o700 });
  const entry = resolve(dir, pebble.web);
  const info = await stat(entry);
  const manifest: WebBuild = { version: 1, bundled: info.isFile(), files: [], maps: {} };
  if (info.isDirectory()) await buildStatic(entry, output, manifest);
  else if (entry.endsWith(".html")) await buildHtml(entry, dir, output, manifest);
  else throw new BedrockError("INVALID_WEB", "The web entry must be HTML or a directory.", "Set web to an existing .html entry or static directory.");
  await Bun.write(join(output, "manifest.json"), JSON.stringify(manifest));
}

async function buildHtml(entry: string, dir: string, output: string, manifest: WebBuild) {
  const result = await Bun.build({
    entrypoints: [entry], root: resolve(entry, ".."), outdir: join(output, "public"),
    target: "browser", publicPath: "/", minify: true, splitting: true, sourcemap: "external",
    naming: { entry: "[name].[ext]", chunk: "chunk-[hash].[ext]", asset: "[name]-[hash].[ext]" },
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    plugins: await plugins(dir),
  });
  if (!result.success) throw new Error(result.logs.map(log => log.message).join("\n"));
  for (const artifact of result.outputs) {
    const name = relative(join(output, "public"), artifact.path).split("\\").join("/");
    if (artifact.kind === "sourcemap") {
      const map = "maps/" + name;
      await Bun.write(join(output, map), artifact);
      await rm(artifact.path, { force: true });
      manifest.maps["/" + name.slice(0, -4)] = map;
    } else manifest.files.push("/" + name);
  }
  const html = manifest.files.find(name => name.endsWith(".html"))!;
  if (html !== "/index.html") {
    await Bun.write(join(output, "public/index.html"), Bun.file(join(output, "public", html)));
    manifest.files.push("/index.html");
  }
}
