import { resolve } from "node:path";
import { commands } from "./commands";
import { commandAt, flagsFor, visibleCommands } from "./registry";
import { globalFlags, remoteFlags, type CommandSpec, type FlagSpec, type Group } from "./spec";

export const authorGuide = resolve(import.meta.dir, "../../AGENTS.md");
const groups: readonly [Group, string][] = [
  ["build", "Build a pebble"], ["ship", "Ship and run"], ["observe", "Observe"],
  ["access", "Access and secrets"], ["server", "Run the server"], ["cli", "This CLI"],
];
export const topics = ["env", "exit-codes"] as const;

const environment = [
  ["BEDROCK_HOME", "Bedrock state directory (default: ~/.bedrock)."],
  ["BEDROCK_URL", "Daemon URL; overridden by --url. Otherwise use the local daemon, then saved login."],
  ["BEDROCK_TOKEN", "Bearer token; overridden by --token. Otherwise use local or saved credentials."],
  ["CLOUDFLARE_API_TOKEN", "Cloudflare API token for setup, tunnel and doctor; overridden by --api-token."],
  ["XDG_CONFIG_HOME", "Saved login directory: $XDG_CONFIG_HOME/bedrock/credentials.json (default: ~/.config)."],
  ["NO_COLOR", "Disable colour when set, including an empty value. Colour otherwise requires a TTY."],
] as const;
const exitCodes = [
  ["0", "Success (including help, version and test discovery)."],
  ["1", "The command ran and failed; bedrock test also uses this for failed checks or flakes."],
  ["2", "Usage error: UNKNOWN_COMMAND, INVALID_ARGS or CONFIRM_REQUIRED; bedrock test also uses this for setup failures."],
  ["130", "Cancelled at a prompt (CANCELLED)."],
] as const;

function heading(text: string, color: boolean) { return color ? `\x1b[1m${text}\x1b[0m` : text; }

function terminalWidth() { return Math.min(100, process.stdout.columns || 80); }

function wrap(text: string, width: number, first = "", continuation = first) {
  const lines: string[] = [];
  let line = first;
  for (const word of text.trim().split(/\s+/)) {
    const separator = line.length > (lines.length ? continuation.length : first.length) ? " " : "";
    if (line.length + separator.length + word.length > width && line.trim()) {
      lines.push(line);
      line = continuation + word;
    } else line += separator + word;
  }
  return [...lines, line].join("\n");
}

function paragraphs(text: string, width: number) {
  return text.split(/\n\s*\n/).map(paragraph => wrap(paragraph, width)).join("\n\n");
}

function rows(entries: readonly (readonly [string, string])[], width = terminalWidth(), labelWidth?: number) {
  const labels = Math.max(0, Math.min(labelWidth ?? Math.max(0, ...entries.map(([name]) => name.length)), Math.floor(width / 2) - 5));
  const indent = " ".repeat(labels + 5);
  return entries.map(([name, summary]) => name.length > labels
    ? `${wrap(name, width, "   ")}\n${wrap(summary, width, indent)}`
    : wrap(summary, width, `   ${name.padEnd(labels)}  `, indent)).join("\n");
}

export function usageSynopses(path: readonly string[], spec: CommandSpec): string[] {
  const prefix = `bedrock ${path.join(" ")}`;
  if (spec.usage?.length) return spec.usage.map(line => `${prefix}${line ? ` ${line}` : ""}`);
  const fallback = commandAt(spec.defaultSubcommand ?? "", spec.subcommands ?? []);
  if (fallback) return [
    ...usageSynopses([...path, `[${fallback.name}]`], fallback),
    ...visibleCommands(spec.subcommands).filter(sub => sub !== fallback).flatMap(sub => usageSynopses([...path, sub.name], sub)),
  ];
  const subs = visibleCommands(spec.subcommands ?? []).map(sub => sub.name).join("|");
  const subcommand = subs ? spec.defaultSubcommand ? `[${subs}]` : `<${subs}>` : "";
  const args = (spec.args ?? []).map(arg => {
    const value = `${arg.choices?.join("|") ?? arg.name}${arg.variadic ? "..." : ""}`;
    return arg.required ? `<${value}>` : `[${value}]`;
  });
  const flags = flagsFor(spec).filter(flag => flag.name !== "--help").map(flag => {
    const value = flag.choices?.join("|") ?? flag.value;
    return `[${flag.name}${value ? ` ${value}` : ""}]`;
  });
  return [[prefix, subcommand, ...args, ...flags].filter(Boolean).join(" ")];
}

function wrappedUsage(line: string, first: boolean, width: number) {
  const indent = "       ";
  let current = first ? "usage:" : "      ";
  const lines: string[] = [];
  // Bracketed options stay together when a long synopsis wraps.
  for (const word of line.match(/\[[^\]]*\]|\S+/g) ?? []) {
    if (current.length + word.length + 1 > width && current.trim()) { lines.push(current); current = indent + word; }
    else current += ` ${word}`;
  }
  return [...lines, current].join("\n");
}

export function renderOverview(color = false, tree: readonly CommandSpec[] = commands) {
  const terminal = terminalWidth();
  const visible = visibleCommands(tree);
  const width = Math.max(0, ...visible.map(spec => spec.name.length));
  const sections = groups.flatMap(([group, title]) => {
    const specs = visible.filter(spec => spec.group === group);
    return specs.length ? [`${heading(title, color)}\n${rows(specs.map(spec => [spec.name, spec.summary]), terminal, width)}`] : [];
  });
  return [wrap("usage: bedrock <command> [<args>] [--json]", terminal, "", "       "),
    wrap('Bedrock runs small apps ("pebbles") on your own server.', terminal), ...sections,
    ["'bedrock help <command>' explains a command, with options and examples.",
      "'bedrock help env' and 'bedrock help exit-codes' explain the environment.",
      `All commands accept --json. The author guide is ${authorGuide}.`].map(line => wrap(line, terminal)).join("\n"),
  ].join("\n\n");
}

function flagLabel(flag: FlagSpec) {
  return `${flag.short ? `${flag.short}, ` : ""}${flag.name}${flag.value ? ` ${flag.value}` : ""}`;
}

function helpForm(spec: CommandSpec): CommandSpec {
  const fallback = commandAt(spec.defaultSubcommand ?? "", spec.subcommands ?? []);
  return fallback ? { ...spec, args: spec.args ?? fallback.args ?? [], remote: Boolean(spec.remote || fallback.remote),
    flags: [...(fallback.flags ?? []), ...(spec.flags ?? [])] } : spec;
}

function docPaths(spec: CommandSpec) {
  return (spec.docs ?? []).map(doc => `${authorGuide}${doc.includes("#") ? doc.slice(doc.indexOf("#")) : ""}`);
}

export function renderCommandHelp(path: readonly string[], spec: CommandSpec, color = false) {
  const width = terminalWidth();
  const parts = [usageSynopses(path, spec).map((line, i) => wrappedUsage(line, i === 0, width)).join("\n"), paragraphs(spec.description ?? spec.summary, width)];
  const section = (name: string, entries: readonly (readonly [string, string])[]) => {
    if (entries.length) parts.push(`${heading(name, color)}\n${rows(entries)}`);
  };
  const form = helpForm(spec);
  section("Arguments", (form.args ?? []).map(arg => [arg.required ? `<${arg.name}${arg.variadic ? "..." : ""}>` : `[${arg.name}${arg.variadic ? "..." : ""}]`, `${arg.summary ?? ""}${arg.choices ? ` (choices: ${arg.choices.join(", ")})` : ""}`]));
  section("Subcommands", visibleCommands(spec.subcommands ?? []).map(sub => [sub.name, sub.summary]));
  section("Options", flagsFor(form).map(flag => [flagLabel(flag), `${flag.summary}${flag.choices ? ` (choices: ${flag.choices.join(", ")})` : ""}`]));
  section("Examples", (spec.examples ?? []).map(example => [example.run, example.summary]));
  const docs = docPaths(spec);
  if (docs.length) parts.push(`${heading("See also", color)}\n${docs.map(doc => `   ${doc}`).join("\n")}`);
  return parts.join("\n\n");
}

function publicTree(tree: readonly CommandSpec[]): CommandSpec[] {
  return visibleCommands(tree).map(spec => ({ ...spec, ...(spec.subcommands ? { subcommands: publicTree(spec.subcommands) } : {}) }));
}

export function overviewJSON(tree: readonly CommandSpec[] = commands) {
  return { command: "help", commands: publicTree(tree), topics: [...topics], globalFlags, remoteFlags };
}

export function commandJSON(path: readonly string[], spec: CommandSpec) {
  const form = helpForm(spec);
  return { command: path.join(" "), usage: usageSynopses(path, spec)[0]!, description: spec.description ?? spec.summary,
    summary: spec.summary, args: form.args ?? [], flags: flagsFor(form), subcommands: publicTree(spec.subcommands ?? []),
    ...(spec.defaultSubcommand ? { defaultSubcommand: spec.defaultSubcommand } : {}),
    examples: spec.examples ?? [], docs: docPaths(spec) };
}

export function topicJSON(topic: typeof topics[number]) {
  return { command: `help ${topic}`, description: topic === "env" ? "Environment variables" : "Exit codes",
    entries: (topic === "env" ? environment : exitCodes).map(([name, description]) => ({ name, description })) };
}

export function renderTopicHelp(topic: typeof topics[number], color = false) {
  const value = topicJSON(topic);
  return `${heading(value.description, color)}\n\n${rows(value.entries.map(entry => [entry.name, entry.description]))}`;
}
