#!/usr/bin/env bun
import { alertsCommand } from "./alerts";
import { errorsCommand } from "./errors";
import { creatorCommand } from "./creator";
import { secretsCommand } from "./secrets";
import { setupWizard } from "./setup";
import { newPebble } from "./new";
import { selfUpdate, remoteSelfUpdate } from "./update";
import { backupCommand } from "./backup";
import { jobsCommand } from "./jobs";
import { buildInfo, formatBuild, sourceCheckout } from "../version";
import { opsCommand, opsCommands } from "./ops";
import { BedrockError, asBedrockError } from "../error";
import { daemonCommand, daemonCommands } from "./daemon";
import { init } from "./init";
import { dbCommand } from "./db";
import { dev, devWorker } from "./dev";
import { bedrockHome } from "../daemon/config";
import { moveData } from "../daemon/move-data";

import { commands } from "./commands";
import { diagnosticWord, locateValue, parse, replaySuggestions, usageError } from "./args";
import { commandAt, flagsFor, resolveCommand, suggestCommands } from "./registry";
import { globalFlags, type CommandSpec, type Handler } from "./spec";
import { formatResult } from "./format";
import { completeCommand, completionCommand } from "./completion";
import { commandJSON, overviewJSON, renderCommandHelp, renderOverview, renderTopicHelp, topicJSON, topics } from "./help";
import { suggest } from "../suggest";
import { plain } from "./terminal";

function stdout(text: string) { process.stdout.write(`${text}\n`); }
function stderr(text: string) { process.stderr.write(`${text}\n`); }

function cliArgs(raw: string[]) {
  const end = raw.indexOf("--");
  const options = end < 0 ? raw : raw.slice(0, end);
  return { json: options.includes("--json"), args: raw.filter((arg, i) => arg !== "--json" || end >= 0 && i > end) };
}

function unknownCommand(word: string, level = commands, path: string[] = [], argv: string[] = [], index = 0) {
  const context = ["bedrock", ...path].join(" ");
  // An option-looking word before any command is a mistyped global flag, never a command name.
  const option = word.startsWith("-");
  const key = word.split("=", 1)[0]!;
  const candidates = ["--version", ...globalFlags.filter(flag => flag.name !== "--help").map(flag => flag.name)];
  const matches = option ? suggest(key, candidates).map(name => name + (word.includes("=") ? word.slice(word.indexOf("=")) : "")) : suggestCommands(word, level);
  const suggestions = replaySuggestions(argv, index, matches);
  const shown = diagnosticWord(argv, index);
  return new BedrockError("UNKNOWN_COMMAND", option ? `Unknown option ${shown} before the command.` : `'${shown}' is not a ${context} command.`,
    path.length ? `Run 'bedrock help ${path.join(" ")}' for details.` : "Run 'bedrock help' to see all commands.", undefined, suggestions.length ? { data: { suggestions } } : {});
}

function helpPath(words: string[]) {
  let resolved = resolveCommand(words.slice(0, 1), commands, false);
  for (let i = 1; resolved && i < words.length; i++) {
    const word = words[i]!;
    if (word.startsWith("-")) {
      const flags = (spec: CommandSpec): ReturnType<typeof flagsFor> => [...flagsFor(spec), ...(spec.subcommands ?? []).flatMap(flags)];
      const key = word.split("=", 1)[0];
      const flag = flags(resolved.spec).find(flag => flag.name === key || flag.short === key);
      if (flag?.value && !word.includes("=")) i++;
      continue;
    }
    const child = commandAt(word, resolved.spec.subcommands ?? []);
    if (!child) break;
    resolved = { path: [...resolved.path, child.name], spec: child, consumed: i + 1 };
  }
  return resolved;
}

function showHelp(args: string[], json: boolean) {
  const explicit = args[0] === "help";
  const end = args.indexOf("--");
  const before = end < 0 ? args : args.slice(0, end);
  const helpFlag = before.some(arg => arg === "--help" || arg === "-h");
  if (args.length && !explicit && !helpFlag) return false;
  const words = (explicit ? before.slice(1) : before).filter(arg => arg !== "-h" && arg !== "--help");
  const color = Boolean(process.stdout.isTTY) && process.env.NO_COLOR === undefined;
  let value: unknown, text: string;
  if (!words.length) { value = overviewJSON(); text = renderOverview(color); }
  else if (topics.includes(words[0] as typeof topics[number]) && words.length === 1) {
    const topic = words[0] as typeof topics[number];
    value = topicJSON(topic); text = renderTopicHelp(topic, color);
  } else {
    const resolved = explicit ? resolveCommand(words, commands, false) : helpPath(words);
    if (!resolved || explicit && resolved.consumed < words.length) {
      const path = resolved?.path ?? [];
      const word = words[resolved?.consumed ?? 0]!;
      const level = resolved?.spec.subcommands ?? (resolved ? [] : [...commands, ...topics.map(name => ({ name, summary: name }))]);
      throw unknownCommand(word, level, path, args, args.indexOf(word));
    }
    value = commandJSON(resolved.path, resolved.spec);
    text = renderCommandHelp(resolved.path, resolved.spec, color);
  }
  stdout(json ? JSON.stringify({ ok: true, ...value as object }) : text);
  return true;
}

// One handler per top-level command; each receives input already checked against commands.ts.
const handlers: Record<string, Handler> = {
  new: (parsed, json) => newCommand(parsed, json),
  init: (parsed, json) => initCommand(parsed, json),
  dev: (parsed, json) => devCommand(parsed, json),
  db: (parsed, json) => dbCommand(parsed, json),
  data: (parsed, json) => dataCommand(parsed, json),
  "self-update": (parsed, json) => updateCommand(parsed, json),
  version: (parsed, json) => versionCommand(parsed, json),
  test: async (parsed, json) => (await import("./test")).testCommand(parsed, json),
  setup: async (parsed, json) => { const result = await setupWizard(parsed, json); return json ? result : undefined; },
  completion: async (parsed, json) => completionCommand(parsed.positionals, json),
  ...Object.fromEntries(daemonCommands.map(name => [name, daemonCommand])),
  ...Object.fromEntries(opsCommands.map(name => [name, opsCommand])),
  "pebble-token": creatorCommand, session: creatorCommand,
  secrets: secretsCommand, backup: backupCommand, alerts: alertsCommand, errors: errorsCommand, jobs: jobsCommand,
};

async function main() {
  const raw = process.argv.slice(2);
  if (internalEntry(raw) === "__dev_worker") { await devWorker(); return; }
  // Completion consumes raw words, including option-looking ones.
  if (raw[0] === "__complete") { await completeCommand(raw.slice(1), false, commands); return; }
  const { args, json } = cliArgs(raw);
  if (showHelp(args, json)) return;
  const typedCommand = args.shift()!;
  const spec = commandAt(typedCommand);
  if (!spec) throw unknownCommand(typedCommand, commands, [], [typedCommand, ...args]);
  const command = spec.name;
  const parsed = parse([command], args);
  const result = await handlers[command]!(parsed, json);
  if (result === undefined) return;
  const color = Boolean(process.stdout.isTTY) && process.env.NO_COLOR === undefined;
  stdout(json ? JSON.stringify({ ok: true, ...result as object })
    : formatResult(result, { color, width: process.stdout.columns }) ?? JSON.stringify(result, null, 2));
}

export function internalEntry(raw: string[]) {
  if (raw[0] === "__complete") return "__complete";
  return cliArgs(raw).args[0] === "__dev_worker" ? "__dev_worker" : undefined;
}

const newCommand: Handler = async (parsed, json) => {
  const result = await newPebble(parsed.positionals[0]!, parsed.flags["--template"] as string | undefined, { json });
  return json ? result : undefined;
};

const initCommand: Handler = async parsed => ({
  command: "init",
  ...await init(parsed.positionals[0]!, process.cwd(), parsed.flags["--template"] as string | undefined, true, await sourceCheckout()),
});

const devCommand: Handler = async (parsed, json) => {
  const value = parsed.flags["--port"];
  const port = value === undefined ? 3000 : Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw usageError(parsed.path, `Invalid value '${value}' for --port; use an integer from 0 to 65535.`);
  }
  await dev(json, port);
};

const dataCommand: Handler = async (parsed, json) => ({
  command: "data move",
  ...await moveData(bedrockHome(), parsed.positionals[0]!, json ? {} : { progress: line => stderr(plain(line)) }),
});

const updateCommand: Handler = async (parsed, json) => {
  const update = parsed.flags["--remote"] ? await remoteSelfUpdate(json ? {} : {
    onUpdate: update => stdout(plain(`Updating remote bedrock ${update.from.slice(0, 7)} → ${update.to.slice(0, 7)} · waiting for daemon…`)),
  }) : await selfUpdate();
  if (json) return update;
  stdout(plain("remote" in update
    ? `✓ Updated bedrock on ${update.domain} ${update.from.slice(0, 7)} → ${update.to.slice(0, 7)} · daemon back in ${update.seconds}s`
    : `✓ Updated bedrock ${update.from.slice(0, 7)} → ${update.to.slice(0, 7)}${update.restarted ? " · service restarted" : ""}`));
};

const versionCommand: Handler = async (_parsed, json) => {
  const info = await buildInfo();
  if (json) return info;
  stdout(formatBuild(info));
};

export function exitCodeFor(code: string, command?: string) {
  if (code === "CANCELLED") return 130;
  if (command === "test" || ["UNKNOWN_COMMAND", "INVALID_ARGS", "CONFIRM_REQUIRED"].includes(code)) return 2;
  return 1;
}

export function errorValue(error: BedrockError, argv: string[], json = false) {
  const value = error.toJSON();
  const data = errorData(value.data);
  if (!data || !Array.isArray(data.suggestions)) return value;
  const unknown = typeof data.unknown === "string" ? data.unknown : undefined;
  const argument = error.code === "PEBBLE_NOT_FOUND" ? "pebble" : error.code === "JOB_NOT_FOUND" ? "job"
    : error.code === "BACKUP_NOT_FOUND" ? "--at" : error.code === "NOT_FOUND" && argv[0] === "errors"
      ? error.message === "Merge target not found." ? "target" : "issue" : undefined;
  const location = unknown === undefined ? undefined : locateValue(argv, unknown, argument);
  const lines = data.suggestions.filter((word: unknown): word is string => typeof word === "string")
    .flatMap((word: string) => unknown === undefined ? [word]
      : location ? replaySuggestions(argv, location.index, [`${location.prefix}${word}`]) : []);
  // argv arrives without --json; an agent that asked for JSON should be handed a line that keeps asking.
  value.data = { ...data, suggestions: json ? lines.map(withJson) : lines };
  return value;
}

/** Adds --json to a suggested command line, before any `--` so it stays an option. */
function withJson(line: string) {
  const words = shellWords(line);
  const end = words.find(word => word.text === "--");
  if (words.some(word => word.text === "--json" && (!end || word.start < end.start))) return line;
  return end ? `${line.slice(0, end.start)}--json ${line.slice(end.start)}` : `${line} --json`;
}

/** Splits a line built by replaySuggestions: words are bare or single-quoted with '\'' escapes. */
function shellWords(line: string) {
  const words: { text: string; start: number }[] = [];
  let text = "", start = 0, quoted = false;
  for (let i = 0; i <= line.length; i++) {
    const char = line[i];
    if (!quoted && (char === " " || char === undefined)) {
      if (i > start) words.push({ text, start });
      text = ""; start = i + 1;
    } else if (char === "'") quoted = !quoted;
    else if (!quoted && char === "\\") text += line[++i] ?? "";
    else text += char;
  }
  return words;
}

export function formatError(value: ReturnType<BedrockError["toJSON"]>) {
  const data = errorData(value.data);
  const suggestions = data && Array.isArray(data.suggestions)
    ? data.suggestions.filter((word: unknown): word is string => typeof word === "string") as string[] : [];
  const block = suggestions.length ? `\n\nDid you mean ${suggestions.length === 1 ? "this" : "one of these"}?\n${suggestions.map(word => `    ${plain(word)}`).join("\n")}\n` : "";
  const hint = plain(value.hint);
  const repair = suggestions.length && typeof data?.unknown === "string"
    ? hint.replace(/^Did you mean [^?]*\?\s*/, "") : hint;
  return `${value.code}: ${plain(value.message)}${block}\nHint: ${repair}`;
}

function errorData(value: unknown) {
  return value && typeof value === "object" ? value as Record<string, unknown> : undefined;
}

if (import.meta.main) {
  await main().catch(error => {
    const typed = asBedrockError(error, "CLI_FAILED", "Check the working directory, dependencies, and command arguments.");
    if (internalEntry(process.argv.slice(2)) === "__dev_worker") {
      process.send?.({ error: typed.toJSON() });
      process.exitCode = 1;
      return;
    }
    const { args, json } = cliArgs(process.argv.slice(2));
    const value = errorValue(typed, args, json);
    if (json) stdout(JSON.stringify({ ok: false, error: value }));
    else stderr(formatError(value));
    process.exitCode = exitCodeFor(typed.code, args[0]);
  });
}
