import { formatBuild } from "../version";
import { checkDaemonFeatures } from "../features";
import { openBrowser, readCredentials, type Credentials } from "./credentials";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { BedrockError } from "../error";
import { startDaemon } from "../daemon";
import { bedrockHome, readConfig } from "../daemon/config";
import { createArchive } from "../daemon/archive";
import { loadPebble } from "../runtime/load";

function parse(args: string[], hint: string) {
  const positionals: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (["--yes", "--force", "--no-open", "-f"].includes(arg)) flags[arg] = "true";
    else if (arg.startsWith("--")) {
      if (!["--port", "--url", "--token"].includes(arg) || !args[i + 1] || args[i + 1]!.startsWith("--")) throw new BedrockError("INVALID_ARGS", `Invalid flag: ${arg}`, hint);
      flags[arg] = args[++i]!;
    } else positionals.push(arg);
  }
  return { positionals, flags };
}

export async function connection(flags: Record<string, string>, options: { home?: string; credentials?: () => Promise<Credentials | null>; fetch?: typeof fetch } = {}) {
  const home = options.home ?? bedrockHome();
  const credentialsReader = options.credentials ?? readCredentials;
  const explicit = flags["--url"] ?? process.env.BEDROCK_URL;
  const explicitToken = flags["--token"] ?? process.env.BEDROCK_TOKEN;
  if (explicit) {
    const credentials = explicitToken ? null : await credentialsReader();
    let origin: string;
    try { origin = new URL(explicit).origin; } catch { throw new BedrockError("INVALID_REMOTE_URL", "Invalid daemon URL.", "Use --url https://bedrock.<domain>."); }
    const token = explicitToken ?? (credentials?.url === origin ? credentials.token : "");
    if (!token) throw new BedrockError("TOKEN_MISSING", "No token for this daemon URL.", "Run bedrock login --url <url> or pass --token.");
    return { url: explicit, token };
  }
  const state = await Bun.file(join(home, "daemon.json")).json().catch(() => null);
  const port = state?.port ?? (await readConfig(home).catch(() => null))?.port;
  const local = (await Bun.file(join(home, "admin-token")).text().catch(() => "")).trim();
  if (port && (local || explicitToken)) {
    try {
      const response = await (options.fetch ?? fetch)(`http://127.0.0.1:${port}/api/pebbles`, { headers: { host: `bedrock.localhost:${port}`, authorization: `Bearer ${explicitToken ?? local}` }, signal: AbortSignal.timeout(1000) });
      if (response.ok || response.status === 401) return { url: `http://bedrock.localhost:${port}`, token: explicitToken ?? local };
    } catch {}
  }
  const credentials = await credentialsReader();
  if (credentials) return { url: credentials.url, token: explicitToken ?? credentials.token };
  throw new BedrockError("DAEMON_UNREACHABLE", "No local daemon or remote credentials are available.", "Start bedrock daemon locally, or run bedrock login --url https://bedrock.<domain>.");
}

export async function call(flags: Record<string, string>, path: string, init: RequestInit = {}) {
  const { url, token } = await connection(flags);
  const target = new URL(path, url);
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  // *.localhost is not resolved by every operating system resolver.
  if (target.hostname === "bedrock.localhost") { headers.set("host", target.host); target.hostname = "127.0.0.1"; }
  const response = await fetch(target, { ...init, headers, redirect: "error" });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new BedrockError(body?.error?.code ?? "DAEMON_REQUEST_FAILED", body?.error?.message ?? `Daemon returned HTTP ${response.status}.`, body?.error?.hint ?? "Check the daemon URL, token, and logs.");
  }
  return response;
}

export const daemonCommands = ["daemon", "deploy", "ls", "logs", "start", "stop", "restart", "rollback", "rm", "token", "whoami", "status"];
export async function daemonCommand(command: string, args: string[], json: boolean, options: { open?: typeof openBrowser; tty?: boolean } = {}): Promise<unknown> {
  const usage: Record<string, string> = {
    daemon: "[--port <port>]", deploy: "[dir] [--no-open]", ls: "", logs: "<name> [-f]",
    start: "<name>", stop: "<name>", restart: "<name>", rollback: "<name> [--force]",
    rm: "<name> --yes", token: "create|ls|revoke <id>", whoami: "", status: "",
  };
  const hint = `Use bedrock ${command}${usage[command] ? ` ${usage[command]}` : ""}${command === "daemon" ? "" : " [--url <url>] [--token <token>]"} [--json].`;
  const { positionals, flags } = parse(args, hint);
  const name = positionals[0];
  const invalid = () => { throw new BedrockError("INVALID_ARGS", `Invalid arguments for ${command}.`, hint); };
  const allowed = command === "rollback" ? ["--url", "--token", "--force"] : command === "daemon" ? ["--port"] : command === "deploy" ? ["--url", "--token", "--no-open"] : command === "logs" ? ["--url", "--token", "-f"] : command === "rm" ? ["--url", "--token", "--yes"] : ["--url", "--token"];
  if (Object.keys(flags).some(key => !allowed.includes(key))) invalid();
  if (command === "daemon") {
    if (positionals.length) invalid();
    const running = await startDaemon({ ...(flags["--port"] ? { port: Number(flags["--port"]) } : {}) });
    const value = { command, url: `http://bedrock.localhost:${running.server.port}`, home: running.home };
    console.log(json ? JSON.stringify({ ok: true, ...value }) : `Bedrock daemon: ${value.url}`);
    const stop = async () => { await running.stop(); process.exit(0); };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    return undefined;
  }
  if (command === "whoami" || command === "status") {
    if (positionals.length) invalid();
    const daemon = await connection(flags);
    const value = (await (await call(flags, "/api/status")).json()).value;
    const pebbles = value.pebbles.map((pebble: { name: string }) => ({ ...pebble, url: value.domain === "localhost" ? `http://${pebble.name}.localhost:${new URL(daemon.url).port}` : `https://${pebble.name}.${value.domain}` }));
    if (!json) { console.log(`Daemon  ${daemon.url} · ${formatBuild(value)}\nUser: ${value.user ?? "creator deploy token"}\n${pebbles.map((pebble: { name: string; url: string }) => `${pebble.name}  ${pebble.url}`).join("\n") || "No pebbles yet. Run bedrock new my-app."}`); return; }
    return { command, daemon: daemon.url, ...value, pebbles };
  }
  if (command === "deploy") {
    if (positionals.length > 1) invalid();
    const dir = resolve(name ?? process.cwd());
    const pebble = await loadPebble(dir);
    const status = (await (await call(flags, "/api/status")).json()).value;
    checkDaemonFeatures(pebble, status);
    const temp = await mkdtemp(join(tmpdir(), "bedrock-deploy-"));
    try {
      const archive = join(temp, "pebble.tar.gz");
      await createArchive(dir, archive);
      const first = !status.pebbles.some((record: { name: string }) => record.name === pebble.name);
      const result = await (await call(flags, `/api/deploy?name=${pebble.name}`, { method: "POST", body: Bun.file(archive), headers: { "content-type": "application/gzip" } })).json();
      const domain = status.domain ?? new URL((await connection(flags)).url).hostname.replace(/^bedrock\./, "");
      const url = domain === "localhost" ? `http://${pebble.name}.localhost:${new URL((await connection(flags)).url).port}` : `https://${pebble.name}.${domain}`;
      if (!json) {
        console.log(`✓ Deployed ${pebble.name}\n${url}`);
        if (first && pebble.access && pebble.access !== "public") console.log(`Access: ${pebble.access === "users" ? "anyone signed in with Google" : pebble.access === "creators" ? "server creators" : pebble.access.allow.join(", ")}.`);
        if ((options.tty ?? process.stdin.isTTY) && !flags["--no-open"]) await (options.open ?? openBrowser)(url);
        return;
      }
      return { command, ...result, url };
    } finally { await rm(temp, { recursive: true, force: true }); }
  }
  if (command === "ls") {
    if (positionals.length) invalid();
    return { command, ...(await (await call(flags, "/api/pebbles")).json()) };
  }
  if (command === "token") {
    if (!name || !["create", "ls", "revoke"].includes(name) || positionals.length !== (name === "revoke" ? 2 : 1)) invalid();
    const id = positionals[1];
    if (name === "revoke" && !/^[a-f0-9]{64}$/.test(id ?? "")) invalid();
    return { command: `token ${name}`, ...(await (await call(flags, name === "revoke" ? `/api/tokens/${id}` : "/api/tokens", { method: name === "create" ? "POST" : name === "revoke" ? "DELETE" : "GET" })).json()) };
  }
  if (positionals.length !== 1) invalid();
  const path = `/api/pebbles/${encodeURIComponent(name!)}`;
  if (command === "logs") {
    if (!flags["-f"]) {
      const logs = await (await call(flags, `${path}/logs`)).text();
      if (json) return { command, name, logs };
      process.stdout.write(logs);
      return undefined;
    }
    const controller = new AbortController();
    const stop = () => controller.abort();
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    let opened = false;
    const decoder = new TextDecoder();
    const write = (text: string) => process.stdout.write(json ? JSON.stringify(text).slice(1, -1) : text);
    try {
      const response = await call(flags, `${path}/logs?follow=true`, { signal: controller.signal });
      if (json) process.stdout.write('{"ok":true,"command":"logs","logs":"');
      opened = true;
      for await (const chunk of response.body!) write(decoder.decode(chunk, { stream: true }));
    } catch (error) { if (!controller.signal.aborted) throw error; }
    finally {
      if (opened) { write(decoder.decode()); if (json) process.stdout.write('"}\n'); }
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
    }
    return undefined;
  }
  if (command === "rm") {
    if (!flags["--yes"]) throw new BedrockError("CONFIRM_REQUIRED", "Deleting a pebble removes all code, data, and logs.", "Run bedrock rm <name> --yes to confirm.");
    return { command, ...(await (await call(flags, `${path}?confirm=true`, { method: "DELETE" })).json()) };
  }
  return { command, ...(await (await call(flags, `${path}/${command}${flags["--force"] ? "?force=true" : ""}`, { method: "POST" })).json()) };
}
