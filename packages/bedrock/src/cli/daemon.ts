import { validateTokenScope } from "../daemon/token-scope";
import { refreshLinuxService } from "../service";
import { deployWarnings } from "./deploy-warnings";
import { formatProvenance, gitProvenance } from "../version";
import { checkDaemonFeatures } from "../features";
import { openBrowser, readCredentials, type Credentials } from "./credentials";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { BedrockError, asBedrockError } from "../error";
import { startDaemon } from "../daemon";
import { bedrockHome, readConfig } from "../daemon/config";
import { createArchive } from "../daemon/archive";
import { encodeProvenance } from "../daemon/provenance";
import { loadPebble } from "../runtime/load";
import { plain } from "./terminal";
import { usageError } from "./args";
import type { Handler, Parsed } from "./spec";

export async function connection(flags: Record<string, string | true>, options: { home?: string; credentials?: () => Promise<Credentials | null>; fetch?: typeof fetch } = {}) {
  const home = options.home ?? bedrockHome();
  const credentialsReader = options.credentials ?? readCredentials;
  const explicit = (flags["--url"] as string | undefined) ?? process.env.BEDROCK_URL;
  const explicitToken = (flags["--token"] as string | undefined) ?? process.env.BEDROCK_TOKEN;
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

export async function call(flags: Record<string, string | true>, path: string, init: RequestInit = {}) {
  const { url, token } = await connection(flags);
  const target = new URL(path, url);
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  // *.localhost is not resolved by every operating system resolver.
  if (target.hostname === "bedrock.localhost") { headers.set("host", target.host); target.hostname = "127.0.0.1"; }
  const response = await fetch(target, { ...init, headers, redirect: "error" });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new BedrockError(body?.error?.code ?? "DAEMON_REQUEST_FAILED", body?.error?.message ?? `Daemon returned HTTP ${response.status}.`, body?.error?.hint ?? "Check the daemon URL, token, and logs.", undefined, { data: body?.error?.data });
  }
  return response;
}

export const daemonCommands = ["daemon", "deploy", "ls", "logs", "start", "stop", "restart", "rollback", "rm", "token", "whoami", "status", "metrics"];
export const daemonCommand = (async (parsed: Parsed, json: boolean, options: { open?: typeof openBrowser; tty?: boolean } = {}): Promise<unknown> => {
  const { positionals, flags } = parsed;
  const command = parsed.path[0]!;
  const name = positionals[0];
  if (command === "daemon") {
    const port = flags["--port"];
    if (port !== undefined && (!/^\d+$/.test(String(port)) || !Number.isInteger(Number(port)) || Number(port) > 65535))
      throw usageError(parsed.path, `Invalid value '${plain(String(port))}' for --port; use an integer from 0 to 65535.`);
    // An unattended host must still boot when the unit cannot be refreshed (full disk, no user bus).
    await refreshLinuxService({ home: bedrockHome() }).catch(error => console.warn("Could not refresh the systemd unit; continuing.", asBedrockError(error).toJSON()));
    const running = await startDaemon({ ...(flags["--port"] ? { port: Number(flags["--port"]) } : {}) });
    const value = { command, url: `http://bedrock.localhost:${running.server.port}`, home: running.home };
    console.log(json ? JSON.stringify({ ok: true, ...value }) : `Bedrock daemon: ${value.url}`);
    const stop = async () => { await running.stop(); process.exit(0); };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    return undefined;
  }
  if (command === "whoami" || command === "status") {
    const daemon = await connection(flags);
    const value = (await (await call(flags, "/api/status")).json()).value;
    const pebbles = value.pebbles.map((pebble: { name: string }) => ({ ...pebble, url: value.domain === "localhost" ? `http://${pebble.name}.localhost:${new URL(daemon.url).port}` : `https://${pebble.name}.${value.domain}` }));
    return { command, daemon: daemon.url, ...value, pebbles };
  }
  if (command === "deploy") {
    const dir = resolve(name ?? process.cwd());
    const pebble = await loadPebble(dir);
    const status = (await (await call(flags, "/api/status")).json()).value;
    checkDaemonFeatures(pebble, status);
    const provenance = await gitProvenance(dir);
    const temp = await mkdtemp(join(tmpdir(), "bedrock-deploy-"));
    try {
      const archive = join(temp, "pebble.tar.gz");
      await createArchive(dir, archive);
      const warnings = await deployWarnings(dir, archive, provenance);
      const first = !status.pebbles.some((record: { name: string }) => record.name === pebble.name);
      const result = await (await call(flags, `/api/deploy?name=${pebble.name}`, { method: "POST", body: Bun.file(archive), headers: { "content-type": "application/gzip", "x-bedrock-provenance": encodeProvenance(provenance) } })).json();
      warnExclusive(pebble.name, result);
      const domain = status.domain ?? new URL((await connection(flags)).url).hostname.replace(/^bedrock\./, "");
      const url = domain === "localhost" ? `http://${pebble.name}.localhost:${new URL((await connection(flags)).url).port}` : `https://${pebble.name}.${domain}`;
      if (!json) {
        for (const warning of warnings) console.log(`Warning: ${warning}`);
        console.log(`Source: ${formatProvenance(result.value.provenance)}`);
        console.log(`✓ Deployed ${pebble.name}\n${url}`);
        console.log(`Public routes: ${(result.value.public_routes ?? []).join(", ") || "none"}`);
        if (first && pebble.access && pebble.access !== "public") console.log(`Access: ${pebble.access === "users" ? "anyone signed in with Google" : pebble.access === "creators" ? "server creators" : pebble.access.allow.join(", ")}.`);
        if ((options.tty ?? process.stdin.isTTY) && !flags["--no-open"]) await (options.open ?? openBrowser)(url);
        return;
      }
      return { command, ...result, url, warnings };
    } finally { await rm(temp, { recursive: true, force: true }); }
  }
  if (command === "ls") {
    const result = await (await call(flags, "/api/pebbles")).json();
    return { command, ...result };
  }
  if (command === "token") {
    const action = parsed.path[1]!;
    if (!!flags["--pebbles"] !== !!flags["--actions"]) throw usageError(parsed.path, "--pebbles and --actions must be provided together.");
    const pebbles = (flags["--pebbles"] as string | undefined)?.split(",");
    const actions = (flags["--actions"] as string | undefined)?.split(",");
    if (actions) validateTokenScope({ pebbles: pebbles!, actions });
    const input = { ...(flags["--name"] ? { name: flags["--name"] } : {}), ...(pebbles ? { scope: { pebbles, actions } } : {}) };
    const id = positionals[0];
    if (action === "revoke" && !/^[a-f0-9]{64}$/.test(id ?? "")) throw usageError(parsed.path, `Invalid token ID '${id}'; expected 64 lowercase hexadecimal characters.`);
    return { command: `token ${action}`, ...(await (await call(flags, action === "revoke" ? `/api/tokens/${id}` : "/api/tokens", { method: action === "create" ? "POST" : action === "revoke" ? "DELETE" : "GET", ...(action === "create" ? { headers: { "content-type": "application/json" }, body: JSON.stringify(input) } : {}) })).json()) };
  }
  if (command === "metrics" || command === "logs") {
    const limit = flags["--limit"], since = flags["--since"];
    if (limit !== undefined && (!/^\d+$/.test(String(limit)) || Number(limit) < 1 || Number(limit) > 1000))
      throw usageError(parsed.path, `Invalid value '${plain(String(limit))}' for --limit; use an integer from 1 to 1000.`);
    if (since !== undefined) {
      const match = /^(\d+)(s|m|h|d)$/.exec(String(since));
      const duration = match ? Number(match[1]) * ({ s: 1, m: 60, h: 3600, d: 86400 }[match[2]!] ?? 0) : 0;
      if (!Number.isSafeInteger(duration) || duration <= 0 || duration > 365 * 86400)
        throw usageError(parsed.path, `Invalid value '${plain(String(since))}' for --since; use a positive s/m/h/d duration up to 365d.`);
    }
  }
  const path = `/api/pebbles/${encodeURIComponent(name!)}`;
  if (command === "metrics" || command === "logs" && !flags["--follow"] && (json || flags["--search"] || flags["--since"] || flags["--cursor"] || flags["--limit"])) {
    const query = new URLSearchParams({ format: "json" });
    for (const [flag, key] of [["--search", "q"], ["--since", "since"], ["--step", "step"], ["--cursor", "cursor"], ["--limit", "limit"]]) if (flags[flag!]) query.set(key!, flags[flag!] as string);
    const result = await (await call(flags, `${path}/${command}?${query}`)).json();
    return { command, name, ...result, ...(command === "logs" ? { logs: [...result.value.rows].reverse().map((row: { time: number; text: string }) => `${new Date(row.time).toISOString()} ${row.text}\n`).join("") } : {}) };
  }
  if (command === "logs") {
    const conflict = ["--search", "--since", "--cursor", "--limit"].find(key => flags[key]);
    if (flags["--follow"] && conflict) throw usageError(parsed.path, `--follow cannot be combined with ${conflict}.`);
    if (!flags["--follow"]) {
      const logs = await (await call(flags, `${path}/logs`)).text();
      return { command, name, logs };
    }
    const controller = new AbortController();
    const stop = () => controller.abort();
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    let opened = false;
    const decoder = new TextDecoder();
    // A transport chunk can end halfway through a terminal escape sequence.
    let pending = "";
    const write = (text: string, flush = false) => {
      if (json) { process.stdout.write(JSON.stringify(text).slice(1, -1)); return; }
      pending += text;
      const end = flush ? pending.length : pending.lastIndexOf("\n") + 1;
      if (end) { process.stdout.write(plain(pending.slice(0, end))); pending = pending.slice(end); }
    };
    try {
      const response = await call(flags, `${path}/logs?follow=true`, { signal: controller.signal });
      if (json) process.stdout.write('{"ok":true,"command":"logs","logs":"');
      opened = true;
      for await (const chunk of response.body!) write(decoder.decode(chunk, { stream: true }));
    } catch (error) { if (!controller.signal.aborted) throw error; }
    finally {
      if (opened) {
        write(decoder.decode(), true);
        if (json) {
          const page = await call(flags, `${path}/logs?format=json&limit=1`).then(response => response.json()).then(body => body.value).catch(() => null);
          process.stdout.write(`","value":${JSON.stringify({ cursor: null, coverage: page?.coverage ?? null, drops: page?.drops ?? null, historical_drops: page?.historical_drops ?? null })}}\n`);
        }
      }
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
    }
    return undefined;
  }
  if (command === "rm") {
    if (!flags["--yes"]) throw new BedrockError("CONFIRM_REQUIRED", "Deleting a pebble removes all code, data, and logs.", "Run bedrock rm <name> --yes to confirm.");
    return { command, ...(await (await call(flags, `${path}?confirm=true`, { method: "DELETE" })).json()) };
  }
  const result = await (await call(flags, `${path}/${command}${flags["--force"] ? "?force=true" : ""}`, { method: "POST" })).json();
  warnExclusive(name!, result);
  return { command, ...result };
}) satisfies Handler;

export function warnExclusive(name: string, result: { value?: { exclusive_services?: string } }) {
  if (result.value?.exclusive_services === "failed") console.warn(`Warning: exclusive services failed for ${name}; the replacement release is selected. Check bedrock logs ${name}.`);
}
