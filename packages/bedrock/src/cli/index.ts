#!/usr/bin/env bun
import { phase7Command } from "./phase7";
import { version } from "../../package.json";
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
  if (command === "--version" && !args.length) { console.log(json ? JSON.stringify({ ok: true, version }) : version); return; }
  if (command === "__dev_worker") { await devWorker(); return; }
  if (command === "dev") {
    let port = 3000;
    if (args[0] === "--port" && args.length === 2) { port = Number(args[1]); args.length = 0; }
    if (args.length || !Number.isInteger(port) || port < 0 || port > 65535) throw new BedrockError("INVALID_ARGS", "Invalid dev arguments.", "Use bedrock dev [--port 0..65535] [--json].");
    await dev(json, port);
    return;
  }
  let result: unknown;
  if (command === "backup" || command === "jobs") result = await phase7Command(command, args);
  else if (command && opsCommands.includes(command)) {
    result = await opsCommand(command, args, json);
    if (result === undefined) return;
  } else if (command && daemonCommands.includes(command)) {
    result = await daemonCommand(command, args, json);
    if (result === undefined) return;
  }
  else if (command === "init" && (args.length === 1 || args.length === 3 && args[1] === "--template")) result = { command: "init", ...await init(args[0]!, process.cwd(), args[2]) };
  else if (command === "db" && args.length === 1 && ["generate", "plan", "migrate"].includes(args[0]!)) result = await dbCommand(args[0]!);
  else throw new BedrockError("UNKNOWN_COMMAND", "Unknown command or arguments.", "Use bedrock init <name> [--template react], dev [--port n], db generate|plan|migrate, setup, daemon, deploy, ls, logs, start|stop|restart, rollback, rm, token create|ls|revoke, tunnel setup|status|teardown, service install|uninstall|status, doctor, login --url <url>, logout, backup setup|run|ls|restore, jobs ls|run, or --version; add --json for machine-readable output.");
  console.log(json ? JSON.stringify({ ok: true, ...(result as object) }) : JSON.stringify(result, null, 2));
}

if (import.meta.main) {
  main().catch(error => {
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
