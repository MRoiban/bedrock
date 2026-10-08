#!/usr/bin/env bun
import { secretsCommand } from "./secrets";
import { setupWizard } from "./setup";
import { newPebble } from "./new";
import { selfUpdate, remoteSelfUpdate } from "./update";
import { backupCommand } from "./backup";
import { jobsCommand } from "./jobs";
import { buildInfo, formatBuild } from "../version";
import { opsCommand, opsCommands } from "./ops";
import { BedrockError, asBedrockError } from "../error";
import { daemonCommand, daemonCommands } from "./daemon";
import { init } from "./init";
import { dbCommand } from "./db";
import { dev, devWorker } from "./dev";

async function main() {
  const raw = process.argv.slice(2);
  const json = raw.includes("--json");
  const args = raw.filter(arg => arg !== "--json");
  const command = args.shift();
  if (command === "--version" && !args.length) { const info = await buildInfo(); console.log(json ? JSON.stringify({ ok: true, ...info }) : formatBuild(info)); return; }
  if (command === "__dev_worker") { await devWorker(); return; }
  if (command === "dev") {
    let port = 3000;
    if (args[0] === "--port" && args.length === 2) { port = Number(args[1]); args.length = 0; }
    if (args.length || !Number.isInteger(port) || port < 0 || port > 65535) throw new BedrockError("INVALID_ARGS", "Invalid dev arguments.", "Use bedrock dev [--port 0..65535] [--json].");
    await dev(json, port);
    return;
  }
  let result: unknown;
  if (command === "setup") { result = await setupWizard(args, json); if (!json) return; }
  else if (command === "self-update" && (!args.length || args.length === 1 && args[0] === "--remote")) { const update = args[0] === "--remote" ? await remoteSelfUpdate(json ? {} : { onUpdate: update => console.log(`Updating remote bedrock ${update.from.slice(0, 7)} → ${update.to.slice(0, 7)} · waiting for daemon…`) }) : await selfUpdate(); result = update; if (!json) { console.log("remote" in update ? `✓ Updated bedrock on ${update.domain} ${update.from.slice(0, 7)} → ${update.to.slice(0, 7)} · daemon back in ${update.seconds}s` : `✓ Updated bedrock ${update.from.slice(0, 7)} → ${update.to.slice(0, 7)}${update.restarted ? " · service restarted" : ""}`); return; } }
  else if (command === "new" && (args.length === 1 || args.length === 3 && args[1] === "--template")) { result = await newPebble(args[0]!, args[2] ?? "react", { json }); if (!json) return; }
  else if (command === "secrets") result = await secretsCommand(args);
  else if (command === "backup") result = await backupCommand(args);
  else if (command === "jobs") result = await jobsCommand(args);
  else if (command && opsCommands.includes(command)) {
    result = await opsCommand(command, args, json);
    if (result === undefined) return;
  } else if (command && daemonCommands.includes(command)) {
    result = await daemonCommand(command, args, json);
    if (result === undefined) return;
  }
  else if (command === "init" && (args.length === 1 || args.length === 3 && args[1] === "--template")) result = { command: "init", ...await init(args[0]!, process.cwd(), args[2], true) };
  else if (command === "db" && args.length === 1 && ["generate", "plan", "migrate"].includes(args[0]!)) result = await dbCommand(args[0]!);
  else if (command && ["new", "init", "db", "self-update"].includes(command)) {
    const usage = command === "new" || command === "init" ? " <name> [--template react|minimal]" : command === "db" ? " generate|plan|migrate" : " [--remote]";
    throw new BedrockError("INVALID_ARGS", `Invalid ${command} arguments.`, `Use bedrock ${command}${usage} [--json].`);
  }
  else throw new BedrockError("UNKNOWN_COMMAND", "Unknown command or arguments.", "Use bedrock init <name> [--template react], dev [--port n], db generate|plan|migrate, setup, daemon, deploy, ls, logs, start|stop|restart, rollback, rm, token create|ls|revoke, secrets ls|set|unset, tunnel setup|status|teardown, service install|uninstall|status, doctor, login <domain>, logout, new <name>, self-update, whoami, status, backup setup|run|ls|restore, jobs ls|run, or --version; add --json for machine-readable output.");
  console.log(json ? JSON.stringify({ ok: true, ...(result as object) }) : JSON.stringify(result, null, 2));
}

if (import.meta.main) {
  await main().catch(error => {
    const typed = asBedrockError(error, "CLI_FAILED", "Check the working directory, dependencies, and command arguments.");
    if (process.argv.includes("__dev_worker")) {
      process.send?.({ error: typed.toJSON() });
      process.exitCode = 1;
      return;
    }
    console[process.argv.includes("--json") ? "log" : "error"](process.argv.includes("--json") ? JSON.stringify({ ok: false, error: typed.toJSON() }) : `${typed.code}: ${typed.message}\nHint: ${typed.hint}`);
    process.exitCode = 1;
  });
}
