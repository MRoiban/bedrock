import { linkDependencies } from "./helpers";
import { test, expect } from "bun:test";
import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { tempDirectory } from "./helpers";
import { BedrockError } from "../src/error";
import { errorValue, exitCodeFor, formatError } from "../src/cli/index";

const cli = resolve(import.meta.dir, "../src/cli/index.ts");
async function command(dir: string, args: string[]) {
  const child = Bun.spawn([process.execPath, cli, ...args, "--json"], {
    cwd: dir, env: { ...process.env, BEDROCK_HOME: join(dir, "isolated-home") },
    stdout: "pipe", stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  return { code, value: JSON.parse(stdout), stderr };
}

test("CLI generates from pebble.schema and plans/applies migrations idempotently", async () => {
  const temp = tempDirectory();
  try {
    linkDependencies(resolve(import.meta.dir, "../../../examples/notes/node_modules"), join(temp.dir, "node_modules"));
    await Bun.write(join(temp.dir, "pebble.ts"), `import { definePebble, sqliteTable, text } from "bedrock";
const table = sqliteTable("records", { id: text("id").primaryKey() });
export default definePebble({ name: "generated", schema: { table } });
`);
    const generated = await command(temp.dir, ["db", "generate"]);
    expect(generated.code).toBe(0);
    expect(generated.value.ok).toBe(true);
    expect(readdirSync(join(temp.dir, "migrations")).filter(name => name.endsWith(".sql"))).toHaveLength(1);
    expect((await command(temp.dir, ["db", "generate"])).code).toBe(0);
    expect(readdirSync(join(temp.dir, "migrations")).filter(name => name.endsWith(".sql"))).toHaveLength(1);
    const plan = await command(temp.dir, ["db", "plan"]);
    expect(plan.value.pending).toHaveLength(1);
    expect(plan.value.pending[0].sql).toContain("CREATE TABLE");
    expect((await command(temp.dir, ["db", "migrate"])).value.applied).toHaveLength(1);
    expect((await command(temp.dir, ["db", "migrate"])).value.applied).toEqual([]);
    expect((await command(temp.dir, ["db", "plan"])).value.pending).toEqual([]);
    const invalid = await command(temp.dir, ["not-a-command"]);
    expect(invalid.code).toBe(2);
    expect(invalid.value.error.hint).toBe("Run 'bedrock help' to see all commands.");
    expect(readdirSync(temp.dir).filter(name => name.startsWith(".bedrock-drizzle-"))).toEqual([]);
  } finally { temp.cleanup(); }
});

async function invoke(dir: string, args: string[]) {
  const child = Bun.spawn([process.execPath, cli, ...args], {
    cwd: dir, env: { ...process.env, BEDROCK_HOME: join(dir, "isolated-home"), NO_COLOR: "" }, stdout: "pipe", stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  return { stdout, stderr, code };
}

test("bare CLI succeeds with overview, typos suggest full commands, and JSON help returns the tree", async () => {
  const temp = tempDirectory();
  try {
    const bare = await invoke(temp.dir, []);
    expect(bare.code).toBe(0);
    expect(bare.stderr).toBe("");
    expect(bare.stdout).toStartWith("usage: bedrock <command> [<args>] [--json]");
    expect(bare.stdout).toContain("Build a pebble");
    const typo = await invoke(temp.dir, ["error", "notes", "--token=private-value"]);
    expect(typo.code).toBe(2);
    expect(typo.stdout).toBe("");
    expect(typo.stderr).toBe("UNKNOWN_COMMAND: 'error' is not a bedrock command.\n\nDid you mean this?\n    bedrock errors notes --token <token>\n\nHint: Run 'bedrock help' to see all commands.\n");
    const help = await command(temp.dir, ["help"]);
    expect(help.code).toBe(0);
    expect(help.value).toMatchObject({ ok: true, command: "help", topics: ["env", "exit-codes"] });
    expect(help.value.commands.some((spec: { name: string }) => spec.name === "errors")).toBe(true);
    expect(help.value.commands.some((spec: { hidden?: boolean }) => spec.hidden)).toBe(false);
    expect(readdirSync(temp.dir)).toEqual([]);
  } finally { temp.cleanup(); }
});

test("help resolves command depth, topics and typos without side effects", async () => {
  const temp = tempDirectory();
  try {
    for (const args of [["help", "tunnel", "setup"], ["tunnel", "setup", "--help"], ["tunnel", "--help", "setup"], ["tunnel", "setup", "--api-token", "private-value", "-h"], ["tunnel", "--api-token", "private-value", "setup", "--help"]]) {
      const result = await command(temp.dir, args);
      expect(result.code).toBe(0);
      expect(result.value).toMatchObject({ ok: true, command: "tunnel setup", usage: expect.stringContaining("bedrock tunnel setup"), description: expect.any(String) });
    }
    for (const flag of ["-h", "--help"]) expect((await invoke(temp.dir, [flag])).code).toBe(0);
    const topic = await command(temp.dir, ["help", "exit-codes"]);
    expect(topic.value.command).toBe("help exit-codes");
    expect(topic.value.entries.some((entry: { name: string }) => entry.name === "130")).toBe(true);
    const typo = await command(temp.dir, ["help", "errro"]);
    expect(typo.code).toBe(2);
    expect(typo.value.error.data.suggestions).toEqual(["bedrock help errors --json"]);
    const subTypo = await command(temp.dir, ["help", "tunnel", "setpu"]);
    expect(subTypo.code).toBe(2);
    expect(subTypo.value.error.data.suggestions).toEqual(["bedrock help tunnel setup --json"]);
    const envTypo = await command(temp.dir, ["help", "evn"]);
    expect(envTypo.value.error.data.suggestions).toEqual(["bedrock help env --json"]);
    expect(readdirSync(temp.dir)).toEqual([]);
  } finally { temp.cleanup(); }
});

test("help after -- is a positional; version aliases agree; known command fallthrough is a usage error", async () => {
  const temp = tempDirectory();
  try {
    const literal = await invoke(temp.dir, ["--json", "tunnel", "setup", "--", "--help"]);
    expect(literal.code).toBe(2);
    expect(JSON.parse(literal.stdout).error.code).toBe("INVALID_ARGS");
    expect((await invoke(temp.dir, ["version"])).stdout).toBe((await invoke(temp.dir, ["--version"])).stdout);
    expect((await command(temp.dir, ["version"])).value).toEqual((await command(temp.dir, ["--version"])).value);
    const invalid = await command(temp.dir, ["new", "notes", "extra"]);
    expect(invalid.code).toBe(2);
    expect(invalid.value.error).toMatchObject({ code: "INVALID_ARGS", message: "Unexpected argument 'extra' for bedrock new.", hint: expect.stringContaining("Run 'bedrock help new' for details.") });
    expect(readdirSync(temp.dir)).toEqual([]);
  } finally { temp.cleanup(); }
});

test("daemon value suggestions become safe command lines in text and JSON, retaining unknown", () => {
  const typed = new BedrockError("PEBBLE_NOT_FOUND", "Unknown pebble.", "Choose a deployed pebble.", undefined, { data: { unknown: "noets", suggestions: ["notes"] } });
  const value = errorValue(typed, ["logs", "noets", "--token=private-value"]);
  expect(value.data).toEqual({ unknown: "noets", suggestions: ["bedrock logs notes --token <token>"] });
  expect(errorValue(typed, ["logs", "noets", "--token=private-value"], true).data).toEqual({ unknown: "noets", suggestions: ["bedrock logs notes --token <token> --json"] });
  expect(errorValue(typed, ["logs", "noets", "--search", "foo -- bar"], true).data).toEqual({ unknown: "noets", suggestions: ["bedrock logs notes --search 'foo -- bar' --json"] });
  const literal = new BedrockError("INVALID_ARGS", "Unknown option.", "Retry.", undefined, { data: { suggestions: ["bedrock logs --limit 1 -- --json"] } });
  expect(errorValue(literal, [], true).data).toEqual({ suggestions: ["bedrock logs --limit 1 --json -- --json"] });
  expect(errorValue(typed, ["logs", "--", "noets"], true).data).toEqual({ unknown: "noets", suggestions: ["bedrock logs --json -- notes"] });
  expect(formatError(value)).toBe("PEBBLE_NOT_FOUND: Unknown pebble.\n\nDid you mean this?\n    bedrock logs notes --token <token>\n\nHint: Choose a deployed pebble.");
  expect(JSON.stringify(value)).not.toContain("private-value");
  expect(typed.data).toEqual({ unknown: "noets", suggestions: ["notes"] });
  const many = formatError({ code: "INVALID_ARGS", message: "Choose.", hint: "Retry.", data: { suggestions: ["bedrock logs notes", "bedrock logs news"] } });
  expect(many).toContain("Did you mean one of these?\n    bedrock logs notes\n    bedrock logs news\n\nHint: Retry.");
});

test("exit codes distinguish usage, command failures, test setup and cancellation", () => {
  for (const code of ["UNKNOWN_COMMAND", "INVALID_ARGS", "CONFIRM_REQUIRED"]) expect(exitCodeFor(code)).toBe(2);
  expect(exitCodeFor("DAEMON_UNREACHABLE")).toBe(1);
  expect(exitCodeFor("TEST_SETUP_FAILED", "test")).toBe(2);
  expect(exitCodeFor("CANCELLED")).toBe(130);
});

test("registry parsing rejects inline-command mistakes before side effects", async () => {
  const temp = tempDirectory();
  try {
    for (const [args, message, suggestions] of [
      [["new", "x", "--tempalte", "react"], "Unknown option --tempalte for bedrock new.", ["bedrock new x --template react --json"]],
      [["db", "genrate"], "'genrate' is not a bedrock db command.", ["bedrock db generate --json"]],
      [["dev", "--port", "99999"], "Invalid value '99999' for --port; use an integer from 0 to 65535.", undefined],
      [["setup", "identtiy"], "Invalid value 'identtiy' for <step>; choose prereqs, identity, cloudflare, google, backups, service, verify.", ["bedrock setup identity --json"]],
      [["self-update", "--remtoe"], "Unknown option --remtoe for bedrock self-update.", ["bedrock self-update --remote --json"]],
      [["data", "move"], "bedrock data move needs <dir>.", undefined],
      [["version", "--extra"], "Unknown option --extra for bedrock version.", undefined],
      [["test", "--grep", "["], "Invalid regular expression '[' for --grep.", undefined],
    ] as const) {
      const result = await command(temp.dir, [...args]);
      expect(result.code).toBe(2);
      expect(result.stderr).toBe("");
      expect(result.value.error).toMatchObject({ code: "INVALID_ARGS", message });
      if (suggestions) expect(result.value.error.data.suggestions).toEqual([...suggestions]);
    }
    expect(readdirSync(temp.dir)).toEqual([]);
  } finally { temp.cleanup(); }
});

test("completion prints scripts and handles raw words before global flags and help", async () => {
  const temp = tempDirectory();
  try {
    const script = await invoke(temp.dir, ["completion", "bash"]);
    expect(script.code).toBe(0);
    expect(script.stderr).toBe("");
    expect(script.stdout).toContain("complete -F _bedrock_complete bedrock");
    const json = await command(temp.dir, ["completion", "fish"]);
    expect(json.value).toMatchObject({ ok: true, command: "completion", shell: "fish", script: expect.stringContaining("__complete") });
    expect(await invoke(temp.dir, ["__complete", "lo"])).toEqual({ code: 0, stdout: "logs\nlogin\nlogout\n", stderr: "" });
    expect(await invoke(temp.dir, ["__complete", "--json", "--j"])).toEqual({ code: 0, stdout: "", stderr: "" });
    expect(await invoke(temp.dir, ["__complete", "--help"])).toEqual({ code: 0, stdout: "--help\n", stderr: "" });
    const aliases = await invoke(temp.dir, ["__complete", "errors", "l"]);
    expect(aliases.stdout).toBe("ls\n");
    expect(readdirSync(temp.dir)).toEqual([]);
  } finally { temp.cleanup(); }
});

test("inline handlers accept equals values and flags before positionals, then format text results", async () => {
  const temp = tempDirectory();
  try {
    const result = await invoke(temp.dir, ["init", "--template=minimal", "notes"]);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(`✓ Initialized notes in ${temp.dir}.\nNext: bedrock dev\n`);
    const repeated = await command(temp.dir, ["init", "--template", "minimal", "notes"]);
    expect(repeated.value).toMatchObject({ ok: true, command: "init", name: "notes", dir: temp.dir, created: false });
    const migration = await invoke(temp.dir, ["db", "new", "--", "-backfill"]);
    expect(migration.code).toBe(0);
    expect(migration.stdout).toMatch(/^✓ Created migrations\/\d{14}_backfill.sql\.\nNext: bedrock db check\n$/);
  } finally { temp.cleanup(); }
});

test("daemon suggestions appear once in text while JSON retains the original hint", () => {
  const hint = "Did you mean 'notes'? Choose a deployed pebble.";
  const typed = new BedrockError("PEBBLE_NOT_FOUND", "Unknown pebble 'noets'.", hint, undefined, { data: { unknown: "noets", suggestions: ["notes"] } });
  const value = errorValue(typed, ["logs", "noets"]);
  expect(value.hint).toBe(hint);
  expect(formatError(value)).toBe("PEBBLE_NOT_FOUND: Unknown pebble 'noets'.\n\nDid you mean this?\n    bedrock logs notes\n\nHint: Choose a deployed pebble.");
  expect(formatError({ ...value, data: { unknown: "noets", suggestions: [] } })).toContain(`Hint: ${hint}`);
});

test("secrets never appear in text or JSON diagnostics, hints or suggestions", async () => {
  const temp = tempDirectory();
  try {
    const probes = [
      ["tunnel", "setpu", "--api-token", "-r2-SENTINEL"],
      ["deploi", "--token", "-SENTINEL"],
      ["--token=SENTINEL", "logs", "notes"],
      ["--token", "-SENTINEL", "logs", "notes"],
      ["help", "--api-token=SENTINEL"],
      ["tunnel", "--api-token", "-SENTINEL", "setpu"],
      ["logs", "notes", "--", "--token=SENTINEL"],
    ];
    for (const args of probes) for (const json of [false, true]) {
      const result = await invoke(temp.dir, json ? [...args, "--json"] : args);
      expect(result.code).toBe(2);
      expect(result.stdout + result.stderr).not.toContain("SENTINEL");
      if (json && !args.includes("--")) expect(JSON.parse(result.stdout).ok).toBe(false);
    }
  } finally { temp.cleanup(); }
});

test("daemon replay locates parsed values, preserving commands, credentials and inline flags", () => {
  for (const [code, argv, unknown, replacement, expected] of [
    ["PEBBLE_NOT_FOUND", ["start", "start"], "start", "starter", "bedrock start starter"],
    ["PEBBLE_NOT_FOUND", ["logs", "--token", "noets", "noets"], "noets", "notes", "bedrock logs --token <token> notes"],
    ["BACKUP_NOT_FOUND", ["backup", "restore", "notes", "--at=2026-01-02", "--yes"], "2026-01-02", "2026-01-03", "bedrock backup restore notes --at=2026-01-03 --yes"],
    ["BACKUP_NOT_FOUND", ["backup", "restore", "notes", "--at", "2026-01-02", "--yes"], "2026-01-02", "2026-01-03", "bedrock backup restore notes --at 2026-01-03 --yes"],
    ["JOB_NOT_FOUND", ["jobs", "run", "notes", "notes"], "notes", "bedrock nightly", "bedrock jobs run notes 'bedrock nightly'"],
    ["NOT_FOUND", ["errors", "show", "42", "42"], "42", "43", "bedrock errors show 42 43"],
  ] as const) {
    const error = new BedrockError(code, "Unknown value.", "Retry.", undefined, { data: { unknown, suggestions: [replacement] } });
    for (const json of [false, true]) {
      expect(errorValue(error, [...argv], json).data).toEqual({ unknown, suggestions: [expected + (json ? " --json" : "")] });
    }
  }
});

test("merge-target replay replaces the target when positional values repeat", () => {
  const error = new BedrockError("NOT_FOUND", "Merge target not found.", "Retry.", undefined,
    { data: { unknown: "42", suggestions: ["43"] } });
  expect(errorValue(error, ["errors", "merge", "42", "42", "42", "--yes"]).data)
    .toEqual({ unknown: "42", suggestions: ["bedrock errors merge 42 42 43 --yes"] });
});

test("worker dispatch recognizes global JSON while completion keeps raw words", async () => {
  const { internalEntry } = await import("../src/cli/index");
  expect(internalEntry(["--json", "__dev_worker"])).toBe("__dev_worker");
  expect(internalEntry(["__dev_worker", "--json"])).toBe("__dev_worker");
  expect(internalEntry(["__complete", "--json", "__dev_worker"])).toBe("__complete");
  expect(internalEntry(["logs", "__dev_worker"])).toBeUndefined();
});

test("error formatting strips daemon control sequences from messages, hints and suggestions", () => {
  const value = { code: "NOT_FOUND", message: "\x1b[31mUnknown\x1b[0m\r value.\x07", hint: "\x1b]0;title\x07Retry.\x00", data: { suggestions: ["bedrock logs \x1b[2Jnotes\x1b[0m"] } };
  expect(formatError(value)).toBe("NOT_FOUND: Unknown value.\n\nDid you mean this?\n    bedrock logs notes\n\nHint: Retry.");
});

test("default help and synonym typo help use the command's local form", async () => {
  const temp = tempDirectory();
  try {
    const text = await invoke(temp.dir, ["help", "errors"]);
    expect(text.stdout).toStartWith("usage: bedrock errors [ls] <pebble>");
    expect(text.stdout).toContain("Arguments\n   <pebble>  Pebble whose issues to list");
    const json = await command(temp.dir, ["help", "errors"]);
    expect(json.value).toMatchObject({ defaultSubcommand: "ls", args: [expect.objectContaining({ name: "pebble" })] });
    const typo = await command(temp.dir, ["help", "jobs", "lsit"]);
    expect(typo.value.error).toMatchObject({ hint: "Run 'bedrock help jobs' for details.", data: { suggestions: ["bedrock help jobs ls --json"] } });
  } finally { temp.cleanup(); }
});

test.skipIf(process.platform !== "linux" || !Bun.which("script"))("empty NO_COLOR controls actual TTY error and help bytes", async () => {
  const temp = tempDirectory();
  try {
    for (const args of ["deploi notes", "help errors", "version"]) {
      const child = Bun.spawn(["script", "-qec", `${process.execPath} '${cli}' ${args}`, "/dev/null"], {
        cwd: temp.dir, env: { ...process.env, BEDROCK_HOME: join(temp.dir, "home"), NO_COLOR: "", FORCE_COLOR: "1" }, stdout: "pipe", stderr: "pipe",
      });
      const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      expect(out + err).not.toContain("\x1b");
      expect(out).toContain(args.startsWith("deploi") ? "UNKNOWN_COMMAND:" : args === "version" ? "bedrock" : "usage: bedrock errors");
      expect(code).toBe(args.startsWith("deploi") ? 2 : 0);
    }
  } finally { temp.cleanup(); }
});
