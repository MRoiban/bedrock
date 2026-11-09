import { realpath, stat } from "node:fs/promises";
import { dirname, join, sep } from "node:path";

// @bedrock/ui's controls are Golem's (github.com/MRoiban/golem): Onyx primitives that load the Anima
// runtime by URL for their motion parts. Each pebble serves the runtime of the Golem it has installed,
// under a path that carries Golem's version, so a page and its runtime always match and a cached
// runtime can never meet a newer page. Pebbles without Golem answer 404 and their controls stay
// plain Onyx.
export const animaPrefix = "/_bedrock/anima/";

interface Golem { version: string; runtime: string }

async function findGolem(dir: string): Promise<Golem | undefined> {
  for (const from of [dir, () => dirname(Bun.resolveSync("@bedrock/ui/package.json", dir))]) {
    try {
      const base = typeof from === "string" ? from : from();
      const manifest = Bun.resolveSync("@mroiban/golem/package.json", base);
      const { version } = await Bun.file(manifest).json() as { version?: unknown };
      const runtime = await realpath(join(dirname(manifest), "runtime"));
      if (typeof version === "string" && (await stat(runtime)).isDirectory()) return { version, runtime };
    } catch { /* Not installed here; try the next place, or serve nothing. */ }
  }
}

const types: Record<string, string> = { ".js": "text/javascript; charset=utf-8", ".ani": "application/json", ".json": "application/json" };

export function createAnimaHandler(dir: string) {
  let golem: Promise<Golem | undefined> | undefined;
  const notFound = () => new Response("Not found", { status: 404 });
  return async (request: Request) => {
    if (!["GET", "HEAD"].includes(request.method)) return new Response("Method not allowed", { status: 405, headers: { allow: "GET, HEAD" } });
    let path: string;
    try { path = decodeURIComponent(new URL(request.url).pathname.slice(animaPrefix.length)); } catch { return notFound(); }
    const [version, ...rest] = path.split("/");
    if (!rest.length || rest.some(part => !part || part === "." || part === ".." || /[\\:]/.test(part))) return notFound();
    const found = await (golem ??= findGolem(dir));
    // Another version is a page from before a redeploy: it falls back to plain Onyx until reloaded.
    if (!found || version !== found.version) return notFound();
    let file: string;
    try {
      file = await realpath(join(found.runtime, ...rest));
      if (!file.startsWith(found.runtime + sep) || !(await stat(file)).isFile()) return notFound();
    } catch { return notFound(); }
    const extension = /\.[^.]+$/.exec(file)?.[0] ?? "";
    const body = Bun.file(file);
    return new Response(request.method === "HEAD" ? null : body, {
      headers: {
        "content-type": types[extension] ?? "application/octet-stream",
        "content-length": String(body.size),
        "cache-control": "public, max-age=31536000, immutable",
        "x-content-type-options": "nosniff",
      },
    });
  };
}
