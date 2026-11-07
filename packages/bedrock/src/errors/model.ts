export interface ErrorFrame { file: string; function: string; line: number; column: number; mapped?: boolean }
export interface ErrorEvent {
  id: string; runtime: "browser" | "server"; mechanism: string; type: string; message: string;
  release: string; frames: ErrorFrame[]; browser: string; bot: boolean;
}
export function scrub(text: string, secrets: string[] = []) {
  for (const secret of secrets) if (secret.length >= 4) text = text.replaceAll(secret, "[REDACTED]");
  text = text.replace(/(^|[^\w-])(["']?)(password|passwd|secret|(?:access[_-]?|refresh[_-]?)?token|api[_-]?key|authorization|cookie|set-cookie|session(?:[_-]?id)?|bearer|client[_-]?secret)\2\s*[:=]\s*(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\r\n,}]+)/gi, "$1$2$3$2=[REDACTED]");
  return text.replace(/https?:\/\/[^\s)]+/gi, value => {
    try { return new URL(value).pathname; } catch { return "[URL]"; }
  }).replace(/[^\s<>@/]+@[^\s<>@/]+\.[^\s<>@/]+/gu, "[EMAIL]")
    .replace(/\b(?:Bearer\s+\S+|(?:brk_|brd_)[\w-]+|eyJ[\w-]+\.[\w-]+\.[\w-]+)\b/gi, "[TOKEN]")
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b|(?<![\w:])(?:[a-f\d]{0,4}:){2,}[a-f\d:.]{0,39}(?![\w:])/gi, "[IP]")
    .replace(/[?#][^\s)]*/g, "").slice(0, 2048);
}
export function stackFrames(stack: string): ErrorFrame[] {
  const frames: ErrorFrame[] = [];
  for (const row of stack.slice(0, 16384).split("\n").slice(0, 50)) {
    const match = /(?:at\s+(?:(.*?)\s+\()?|^(.*?)@)(.+?):(\d+):(\d+)\)?$/.exec(row.trim());
    if (match) frames.push({ file: match[3]!, function: match[1] || match[2] || "<anonymous>", line: Number(match[4]), column: Number(match[5]) });
    if (frames.length === 20) break;
  }
  return frames;
}
export function errorEvent(error: unknown, runtime: ErrorEvent["runtime"], mechanism: string, release: string): ErrorEvent {
  let type = "Error", message = typeof error === "string" ? error : "Non-Error rejection", stack = "";
  try {
    if (error instanceof Error) {
      const field = (key: string) => {
        let object: object | null = error;
        for (let depth = 0; object && depth < 5; depth++, object = Object.getPrototypeOf(object)) {
          const descriptor = Object.getOwnPropertyDescriptor(object, key);
          if (descriptor) return descriptor;
        }
        return undefined;
      };
      const name = field("name"), text = field("message"), trace = field("stack");
      type = typeof name?.value === "string" ? name.value : "Error";
      message = typeof text?.value === "string" ? text.value : "Error";
      if (typeof trace?.value === "string") stack = trace.value;
      // Chromium exposes its lazy stack through a native accessor; application accessors stay untouched.
      else if (!name?.get && !text?.get && trace?.get && Function.prototype.toString.call(trace.get).includes("[native code]")) {
        const nativeStack = trace.get.call(error); if (typeof nativeStack === "string") stack = nativeStack;
      }
    }
  } catch { /* An arbitrary rejection must not run application getters during capture. */ }
  return { id: crypto.randomUUID(), runtime, mechanism, release, type,
    message: scrub(message), frames: stackFrames(stack).map(frame => ({ ...frame, file: scrub(frame.file), function: scrub(frame.function) })), browser: "unknown", bot: false };
}
export function cleanEvent(input: unknown, runtime: ErrorEvent["runtime"], secrets: string[] = []): ErrorEvent | null {
  if (!input || typeof input !== "object") return null;
  const e = input as ErrorEvent;
  if (typeof e.id !== "string" || !/^[a-f0-9-]{36}$/.test(e.id) || typeof e.release !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(e.release) ||
    typeof e.type !== "string" || e.type.length > 100 || typeof e.message !== "string" || e.message.length > 2048 ||
    typeof e.mechanism !== "string" || !/^[a-z-]{1,40}$/.test(e.mechanism) || !Array.isArray(e.frames) || e.frames.length > 20) return null;
  const frames: ErrorFrame[] = [];
  for (const f of e.frames) {
    if (!f || typeof f.file !== "string" || f.file.length > 2048 || typeof f.function !== "string" || f.function.length > 2048 ||
      !Number.isSafeInteger(f.line) || f.line < 1 || f.line > 1e7 || !Number.isSafeInteger(f.column) || f.column < 1 || f.column > 1e7) return null;
    frames.push({ file: scrub(f.file, secrets), function: scrub(f.function, secrets), line: f.line, column: f.column });
  }
  return { id: e.id, runtime, release: e.release, mechanism: e.mechanism, type: scrub(e.type, secrets), message: scrub(e.message, secrets), frames,
    browser: ["Chrome", "Firefox", "Safari", "Edge"].includes(e.browser) ? e.browser : "unknown", bot: e.bot === true };
}
