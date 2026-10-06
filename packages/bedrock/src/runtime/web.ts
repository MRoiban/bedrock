import { stat, realpath } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { BedrockError } from "../error";

export async function loadWeb(dir: string, entry?: string) {
  if (!entry) return {};
  const path = resolve(dir, entry);
  const info = await stat(path);
  if (info.isFile() && path.endsWith(".html")) {
    const html = (await import(path)).default as Bun.HTMLBundle;
    return { html };
  }
  if (!info.isDirectory()) throw new BedrockError("INVALID_WEB", "The web entry must be HTML or a directory.", "Set web to an existing .html entry or static directory.");
  const root = await realpath(path);
  return {
    async staticResponse(request: Request) {
      let pathname: string;
      try { pathname = decodeURIComponent(new URL(request.url).pathname); } catch { return new Response("Not found", { status: 404 }); }
      const target = resolve(root, "." + (pathname.endsWith("/") ? pathname + "index.html" : pathname));
      if (!target.startsWith(root + sep)) return new Response("Not found", { status: 404 });
      try {
        const canonical = await realpath(target);
        if (!canonical.startsWith(root + sep)) return new Response("Not found", { status: 404 });
        if (!(await stat(canonical)).isFile()) return new Response("Not found", { status: 404 });
        return new Response(request.method === "HEAD" ? null : Bun.file(canonical));
      } catch { return new Response("Not found", { status: 404 }); }
    },
  };
}
