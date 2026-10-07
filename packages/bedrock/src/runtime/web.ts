import { stat, realpath } from "node:fs/promises";
import { basename, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { BedrockError } from "../error";

function fingerprinted(path: string) {
  const fingerprint = /[-.]([A-Za-z0-9_-]{8,})\.[^.]+$/.exec(basename(path));
  return !path.endsWith(".html") && !!fingerprint && /\d/.test(fingerprint[1]!);
}

async function staticFile(root: string, pathname: string, request: Request, previous = false) {
  const target = resolve(root, "." + pathname);
  if (!target.startsWith(root + sep)) return;
  try {
    const canonical = await realpath(target);
    if (!canonical.startsWith(root + sep) || (previous && canonical.endsWith(".html"))) return;
    const info = await stat(canonical);
    if (!info.isFile()) return;
    const etag = `W/"${info.size.toString(16)}-${info.mtimeMs.toString(16)}"`;
    const headers = new Headers({
      "cache-control": fingerprinted(pathname) ? "public, max-age=31536000, immutable" : "no-cache",
      etag,
    });
    const matches = request.headers.get("if-none-match")?.split(",").some(value => value.trim() === "*" || value.trim().replace(/^W\//, "") === etag.slice(2));
    if (matches) return new Response(null, { status: 304, headers });
    const file = Bun.file(canonical);
    headers.set("content-type", file.type);
    headers.set("content-length", String(info.size));
    return new Response(request.method === "HEAD" ? null : file, { headers });
  } catch { return; }
}

export async function loadWeb(dir: string, entry?: string) {
  if (!entry) return {};
  const path = resolve(dir, entry);
  const info = await stat(path);
  if (info.isFile() && path.endsWith(".html")) {
    const html = (await import(pathToFileURL(path).href)).default as Bun.HTMLBundle;
    return { html };
  }
  if (!info.isDirectory()) throw new BedrockError("INVALID_WEB", "The web entry must be HTML or a directory.", "Set web to an existing .html entry or static directory.");
  const root = await realpath(path);
  const webDirectory = relative(dir, path);
  const previousRelease = process.env.BEDROCK_PREVIOUS_RELEASE;
  let previousRoot: string | undefined;
  if (previousRelease && webDirectory !== ".." && !webDirectory.startsWith(".." + sep)) {
    try { previousRoot = await realpath(resolve(previousRelease, webDirectory)); } catch { /* A previous release may have used a different web entry. */ }
  }
  return {
    async staticResponse(request: Request) {
      let pathname: string;
      try { pathname = decodeURIComponent(new URL(request.url).pathname); } catch { return new Response("Not found", { status: 404 }); }
      if (process.platform === "win32" && /[\\:]/.test(pathname)) return new Response("Not found", { status: 404 });
      if (pathname.endsWith("/")) pathname += "index.html";
      const current = await staticFile(root, pathname, request);
      if (current) return current;
      if (previousRoot && fingerprinted(pathname)) {
        const previous = await staticFile(previousRoot, pathname, request, true);
        if (previous) return previous;
      }
      return new Response("Not found", { status: 404 });
    },
  };
}
