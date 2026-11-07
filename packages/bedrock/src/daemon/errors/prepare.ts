import { join } from "node:path";
import { symbolicate } from "../source-maps";
import { cleanEvent, scrub, type ErrorEvent } from "../../errors/model";
export async function prepareError(home: string, pebble: string, input: unknown, runtime: ErrorEvent["runtime"], secrets: string[]) {
  const event = cleanEvent(input, runtime, secrets);
  if (!event) return null;
  const root = join(home, "pebbles", pebble, "releases", event.release) + "/";
  const generated = event.frames.map(frame => ({ ...frame, file: frame.file.startsWith(root) ? frame.file.slice(root.length) : frame.file }));
  let missingMaps = false;
  for (const frame of event.frames) {
    if (runtime === "browser" && frame.file.startsWith("/")) {
      try {
        const position = await symbolicate(join(home, "pebbles", pebble, "releases"), event.release, frame.file, frame.line, frame.column);
        if (position) { frame.file = position.source; frame.line = position.line; frame.column = position.column; frame.function = position.function ?? "<anonymous>"; frame.mapped = true; }
        else missingMaps = true;
      } catch { missingMaps = true; }
    }
    if (runtime === "server") {
      if (frame.file.startsWith(root)) { frame.file = frame.file.slice(root.length); frame.mapped = true; }
    }
    frame.file = scrub(frame.file.replace(/^.*?(?:\/releases\/[^/]+\/)/, "").replace(/^(?:\.\.\/|\.\/)+/, ""), secrets);
    frame.function = scrub(frame.function, secrets);
  }
  if (runtime === "browser" && !event.frames.some(frame => frame.mapped)) missingMaps = true;
  const app = event.frames.filter(f => f.mapped && !/(?:node_modules|packages\/bedrock\/src|bun:|node:)/.test(f.file)).slice(0, 5);
  const extension = generated.length > 0 && generated.every(f => /^(?:chrome|moz|safari-web)-extension:/.test(f.file));
  const noise = /^ResizeObserver loop (?:limit exceeded|completed with undelivered notifications)/.test(event.message);
  const identity = app.map(f => [f.file, f.function, f.line]);
  const key = new Bun.CryptoHasher("sha256").update(JSON.stringify([1, runtime, event.type, identity])).digest("hex");
  return { ...event, generated, missingMaps, quarantine: extension, noise, fingerprint: `v1:${extension ? "quarantine:" : noise ? "noise:" : ""}${key}` };
}
export type PreparedError = NonNullable<Awaited<ReturnType<typeof prepareError>>>;
