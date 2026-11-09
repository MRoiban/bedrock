import { mkdir, readdir, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { webBuildDirectory, type WebBuild } from "./web-artifacts";

// Static directories are already built by their author; preserve their URLs and bytes.
async function copyStatic(source: string, output: string, manifest: WebBuild, references: Record<string, string>, prefix = "") {
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (entry.name === webBuildDirectory) continue;
    const name = prefix + entry.name;
    if (entry.isDirectory()) await copyStatic(join(source, entry.name), output, manifest, references, name + "/");
    else if (entry.isFile()) {
      const file = Bun.file(join(source, entry.name));
      if (name.endsWith(".map")) {
        const map = "maps/" + name;
        await Bun.write(join(output, map), file);
        manifest.maps["/" + name.slice(0, -4)] = map;
      } else {
        let content: string | Bun.BunFile = file;
        if (/\.(m?js|cjs|css)$/.test(name)) {
          const text = await file.text();
          const reference = [...text.matchAll(mapComment)].at(-1);
          if (reference) references["/" + name] = (reference[1] ?? reference[2])!.trim();
          content = withoutMapReference(text);
        }
        await Bun.write(join(output, "public", name), content);
        manifest.files.push("/" + name);
      }
    }
  }
}

// Not anchored to the line start: minifiers often append the comment after code on the last line.
const mapComment = /\/\/[#@]\s*sourceMappingURL=([^\s'"`]+)[ \t]*$|\/\*[#@]\s*sourceMappingURL=([^\s*]+)\s*\*\//gm;

function withoutMapReference(text: string) {
  return text.replace(mapComment, "");
}

export async function buildStatic(entry: string, output: string, manifest: WebBuild) {
  const references: Record<string, string> = {};
  await copyStatic(entry, output, manifest, references);
  for (const [bundle, reference] of Object.entries(references)) {
    if (reference.startsWith("data:application/json")) {
      const comma = reference.indexOf(",");
      const text = reference.slice(0, comma).endsWith(";base64")
        ? Buffer.from(reference.slice(comma + 1), "base64").toString() : decodeURIComponent(reference.slice(comma + 1));
      JSON.parse(text);
      const map = "maps" + bundle + ".map";
      await Bun.write(join(output, map), text);
      manifest.maps[bundle] = map;
    } else {
      const url = new URL(reference, "https://static.invalid" + bundle);
      if (url.origin !== "https://static.invalid") continue;
      const pathname = decodeURIComponent(url.pathname);
      if (/[\\\\]/.test(pathname) || pathname.split("/").some(part => part === ".." || part === ".")) continue;
      const map = "maps" + pathname;
      // A referenced map may use any extension (e.g. app.sourcemap.json); never leave it public.
      const published = join(output, "public", pathname);
      if (await Bun.file(published).exists()) {
        await mkdir(dirname(join(output, map)), { recursive: true });
        await rename(published, join(output, map));
        manifest.files = manifest.files.filter(file => file !== pathname);
      }
      if (await Bun.file(join(output, map)).exists()) manifest.maps[bundle] = map;
    }
  }
}
