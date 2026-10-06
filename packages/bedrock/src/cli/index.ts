#!/usr/bin/env bun
import { BedrockError, asBedrockError } from "../error";
import { init } from "./init";
import { dbCommand } from "./db";
import { dev, devWorker } from "./dev";

async function main() {
  const raw = process.argv.slice(2);
  const json = raw.includes("--json");
  const args = raw.filter(arg => arg !== "--json");
  const command = args.shift();
  if (command === "__dev_worker") { await devWorker(); return; }
  if (command === "dev") {
    let port = 3000;
    if (args[0] === "--port" && args.length === 2) { port = Number(args[1]); args.length = 0; }
    if (args.length || !Number.isInteger(port) || port < 0 || port > 65535) throw new BedrockError("INVALID_ARGS", "Invalid dev arguments.", "Use bedrock dev [--port 0..65535] [--json].");
    await dev(json, port);
    return;
  }
  let result: unknown;
  if (command === "init" && args.length === 1) result = { command: "init", ...await init(args[0]!) };
  else if (command === "db" && args.length === 1 && ["generate", "plan", "migrate"].includes(args[0]!)) result = await dbCommand(args[0]!);
  else throw new BedrockError("UNKNOWN_COMMAND", "Unknown command or arguments.", "Use bedrock init <name>, dev [--port n], or db generate|plan|migrate; add --json for machine-readable output.");
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
