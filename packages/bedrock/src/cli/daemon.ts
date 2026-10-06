import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { BedrockError } from "../error";
import { startDaemon } from "../daemon";
import { bedrockHome, readConfig, setup } from "../daemon/config";
import { createArchive } from "../daemon/archive";
import { loadPebble } from "../runtime/load";

function parse(args: string[]) {
  const positionals: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (["--yes", "-f"].includes(arg)) flags[arg] = "true";
    else if (arg.startsWith("--")) {
      if (!["--domain", "--creator", "--port", "--url", "--token"].includes(arg) || !args[i + 1] || args[i + 1]!.startsWith("--")) throw new BedrockError("INVALID_ARGS", `Invalid flag: ${arg}`, "Provide a value for domain, creator, port, url, or token.");
      flags[arg] = args[++i]!;
    } else positionals.push(arg);
  }
  return { positionals, flags };
}

async function connection(flags: Record<string, string>) {
  const home = bedrockHome();
  const explicit = flags["--url"] ?? process.env.BEDROCK_URL;
  let url = explicit;
  if (!url) {
    const state = await Bun.file(join(home, "daemon.json")).json().catch(() => null);
    const port = state?.port ?? (await readConfig(home)).port;
    url = `http://bedrock.localhost:${port}`;
  }
  const token = flags["--token"] ?? process.env.BEDROCK_TOKEN ?? (await Bun.file(join(home, "admin-token")).text().catch(() => "")).trim();
  if (!token) throw new BedrockError("TOKEN_MISSING", "No deploy token is available.", "Start the local daemon, pass --token, or set BEDROCK_TOKEN.");
  return { url, token };
}

async function call(flags: Record<string, string>, path: string, init: RequestInit = {}) {
  const { url, token } = await connection(flags);
  const target = new URL(path, url);
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  // *.localhost is not resolved by every operating system resolver.
  if (target.hostname === "bedrock.localhost") { headers.set("host", target.host); target.hostname = "127.0.0.1"; }
  const response = await fetch(target, { ...init, headers });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new BedrockError(body?.error?.code ?? "DAEMON_REQUEST_FAILED", body?.error?.message ?? `Daemon returned HTTP ${response.status}.`, body?.error?.hint ?? "Check the daemon URL, token, and logs.");
  }
  return response;
}

export const daemonCommands = ["setup", "daemon", "deploy", "ls", "logs", "start", "stop", "restart", "rollback", "rm", "token"];
export async function daemonCommand(command: string, args: string[], json: boolean): Promise<unknown> {
  const { positionals, flags } = parse(args);
  const name = positionals[0];
  const invalid = () => { throw new BedrockError("INVALID_ARGS", `Invalid arguments for ${command}.`, "Use setup --domain <d> [--creator <email>], daemon, deploy [dir], ls, logs <name> [-f], start|stop|restart|rollback <name>, rm <name> --yes, or token create."); };
  const allowed = command === "setup" ? ["--domain", "--creator", "--port"] : command === "daemon" ? ["--port"] : command === "logs" ? ["--url", "--token", "-f"] : command === "rm" ? ["--url", "--token", "--yes"] : ["--url", "--token"];
  if (Object.keys(flags).some(key => !allowed.includes(key))) invalid();
  if (command === "setup") {
    if (positionals.length || !flags["--domain"]) invalid();
    return { command, ...await setup(bedrockHome(), flags["--domain"]!, flags["--creator"], Number(flags["--port"] ?? 3000)) };
  }
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
  if (command === "deploy") {
    if (positionals.length > 1) invalid();
    const dir = resolve(name ?? process.cwd());
    const pebble = await loadPebble(dir);
    const temp = await mkdtemp(join(tmpdir(), "bedrock-deploy-"));
    try {
      const archive = join(temp, "pebble.tar.gz");
      await createArchive(dir, archive);
      return { command, ...(await (await call(flags, `/api/deploy?name=${pebble.name}`, { method: "POST", body: Bun.file(archive), headers: { "content-type": "application/gzip" } })).json()) };
    } finally { await rm(temp, { recursive: true, force: true }); }
  }
  if (command === "ls") {
    if (positionals.length) invalid();
    return { command, ...(await (await call(flags, "/api/pebbles")).json()) };
  }
  if (command === "token") {
    if (positionals.length !== 1 || name !== "create") invalid();
    return { command: "token create", ...(await (await call(flags, "/api/tokens", { method: "POST" })).json()) };
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
  return { command, ...(await (await call(flags, `${path}/${command}`, { method: "POST" })).json()) };
}
