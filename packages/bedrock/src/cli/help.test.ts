import { expect, test } from "bun:test";
import { isAbsolute } from "node:path";
import { authorGuide, commandJSON, overviewJSON, renderCommandHelp, renderOverview, renderTopicHelp, topicJSON, usageSynopses } from "./help";
import type { CommandSpec, Group } from "./spec";

const logs: CommandSpec = {
  name: "logs", summary: "Read logs", description: "Read or follow retained pebble logs.", group: "observe", remote: true,
  args: [{ name: "pebble", required: true, summary: "Deployed pebble" }],
  flags: [{ name: "--follow", short: "-f", summary: "Follow new logs" }, { name: "--since", value: "<age>", summary: "Read recent logs" }, { name: "--step", value: "<step>", choices: ["1m", "1h", "1d"], summary: "Rollup size" }],
  examples: [{ run: "bedrock logs notes -f", summary: "Follow notes" }], docs: ["AGENTS.md#error-tracking"],
};
const tree: readonly CommandSpec[] = [
  ...(["server", "access", "cli", "build", "ship"] as Group[]).map(group => ({ name: group, group, summary: `${group} summary` })),
  logs,
  { name: "alerts", group: "observe", summary: "Manage alerts", defaultSubcommand: "ls", subcommands: [{ name: "ls", summary: "List incidents" }, { name: "__secret", summary: "Private", hidden: true }] },
  { name: "__worker", summary: "Internal", hidden: true },
];

test("overview is grouped in workflow order, aligned across groups and includes the shipped guide", () => {
  const text = renderOverview(false, tree);
  expect(text).toStartWith("usage: bedrock <command> [<args>] [--json]\n\n");
  let previous = -1;
  for (const title of ["Build a pebble", "Ship and run", "Observe", "Access and secrets", "Run the server", "This CLI"]) {
    expect(text.indexOf(title)).toBeGreaterThan(previous);
    previous = text.indexOf(title);
  }
  expect(text).toContain("   logs    Read logs");
  expect(text).toContain("   server  server summary");
  expect(text).not.toContain("__worker");
  expect(text).not.toContain("\x1b");
  expect(isAbsolute(authorGuide)).toBe(true);
  expect(text.replace(/\s+/g, " ")).toEndWith(`All commands accept --json. The author guide is ${authorGuide}.`);
  expect(renderOverview(true, tree)).toContain("\x1b[1mObserve\x1b[0m");
});

test("command help includes arguments, ordered options, choices, examples and absolute doc anchors", () => {
  const text = renderCommandHelp(["logs"], logs);
  expect(text).toStartWith("usage: bedrock logs <pebble> [--follow] [--since <age>] [--step 1m|1h|1d]");
  expect(text).toContain("\n       [--url <url>] [--token <token>] [--json]");
  for (const line of text.split("\n\n")[0]!.split("\n")) expect(line.length).toBeLessThanOrEqual(80);
  expect(text).toContain("Read or follow retained pebble logs.");
  expect(text).toContain("Arguments\n   <pebble>  Deployed pebble");
  expect(text).toContain("-f, --follow");
  expect(text).toContain("--since <age>");
  expect(text).toContain("(choices: 1m, 1h, 1d)");
  const options = text.slice(text.indexOf("Options"));
  expect(options.indexOf("--follow")).toBeLessThan(options.indexOf("--url"));
  expect(options.indexOf("--token")).toBeLessThan(options.indexOf("--json"));
  expect(options.indexOf("--json")).toBeLessThan(options.indexOf("-h, --help"));
  expect(text).toContain("Examples\n   bedrock logs notes -f  Follow notes");
  expect(text).toEndWith(`See also\n   ${authorGuide}#error-tracking`);
  expect(renderCommandHelp(["logs"], logs, true)).toContain("\x1b[1mOptions\x1b[0m");
});

test("usage supports overrides, nested paths, optional/variadic args and defaults", () => {
  expect(usageSynopses(["db", "new"], { name: "new", summary: "New", usage: ["<name>", "--empty <name>"] })).toEqual(["bedrock db new <name>", "bedrock db new --empty <name>"]);
  expect(usageSynopses(["collect"], { name: "collect", summary: "Collect", args: [{ name: "name", required: true }, { name: "files", variadic: true }] })).toEqual(["bedrock collect <name> [files...] [--json]"]);
  const alerts = tree.find(spec => spec.name === "alerts")!;
  expect(usageSynopses(["alerts"], alerts)).toEqual(["bedrock alerts [ls] [--json]"]);
  const text = renderCommandHelp(["alerts"], alerts);
  expect(text).toContain("Subcommands\n   ls  List incidents");
  expect(text).not.toContain("__secret");
});

test("JSON overview returns the recursively visible tree, topics and shared flags", () => {
  const value = overviewJSON(tree);
  expect(value.command).toBe("help");
  expect(value.topics).toEqual(["env", "exit-codes"]);
  expect(value.globalFlags.map(flag => flag.name)).toEqual(["--json", "--help"]);
  expect(value.remoteFlags.map(flag => flag.name)).toEqual(["--url", "--token"]);
  expect(JSON.stringify(value)).not.toContain("__worker");
  expect(JSON.stringify(value)).not.toContain("__secret");
  expect(tree.find(spec => spec.name === "alerts")!.subcommands).toHaveLength(2);
});

test("JSON command preserves the usage/description contract and all structured fields", () => {
  const value = commandJSON(["logs"], logs);
  expect(value).toMatchObject({ command: "logs", usage: usageSynopses(["logs"], logs)[0], description: logs.description, summary: logs.summary, args: logs.args, examples: logs.examples, docs: [`${authorGuide}#error-tracking`], subcommands: [] });
  expect(value.flags.map(flag => flag.name)).toEqual(["--follow", "--since", "--step", "--url", "--token", "--json", "--help"]);
  expect(commandJSON(["alerts"], tree.find(spec => spec.name === "alerts")!).description).toBe("Manage alerts");
});

test("environment and exit-code topics describe user settings, not internal worker transport", () => {
  const env = renderTopicHelp("env");
  for (const name of ["BEDROCK_HOME", "BEDROCK_URL", "BEDROCK_TOKEN", "CLOUDFLARE_API_TOKEN", "XDG_CONFIG_HOME", "NO_COLOR"]) expect(env).toContain(name);
  expect(env).not.toContain("BEDROCK_DEV_OPTIONS");
  expect(env).not.toContain("BEDROCK_TEST_TEMPLATE");
  expect(topicJSON("env").command).toBe("help env");
  expect(topicJSON("exit-codes").entries.map(entry => entry.name)).toEqual(["0", "1", "2", "130"]);
  const exits = renderTopicHelp("exit-codes", true);
  for (const name of ["CANCELLED", "CONFIRM_REQUIRED", "UNKNOWN_COMMAND", "INVALID_ARGS", "setup failures", "failed checks"]) expect(exits.replace(/\s+/g, " ")).toContain(name);
  expect(exits).toStartWith("\x1b[1mExit codes\x1b[0m");
});

test("help wraps paragraphs and summaries to terminal width with hanging indents", () => {
  const columns = process.stdout.columns;
  try {
    process.stdout.columns = 56;
    const spec: CommandSpec = {
      name: "sample", summary: "Sample", description: "A long paragraph describing the command and the circumstances in which someone should use it.\n\nA second paragraph stays separate from the first paragraph.",
      args: [{ name: "name", summary: "An argument summary with enough words to require a second line in this terminal" }],
      flags: [{ name: "--option", summary: "An option summary with enough words to require a second line in this terminal" }],
      subcommands: [{ name: "child", summary: "A subcommand summary with enough words to require a second line in this terminal" }],
    };
    const help = renderCommandHelp(["sample"], spec);
    for (const line of help.split("\n")) expect(line.length).toBeLessThanOrEqual(56);
    expect(help).toContain("\n\nA second paragraph");
    expect(help).toContain("   [name]  An argument summary");
    expect(help).toContain("\n           require a second line");
    expect(help).toContain("\n   child  A subcommand summary");
    expect(help).toContain("\n          require a second line");
    process.stdout.columns = 80;
    for (const line of renderOverview().split("\n")) expect(line.length).toBeLessThanOrEqual(80);
    process.stdout.columns = 150;
    const wide = renderCommandHelp(["sample"], spec);
    for (const line of wide.split("\n")) expect(line.length).toBeLessThanOrEqual(100);
  } finally { process.stdout.columns = columns; }
});

test("default command help describes its usable positional form in text and JSON", async () => {
  const { commands } = await import("./commands");
  const errors = commands.find(spec => spec.name === "errors")!;
  const value = commandJSON(["errors"], errors);
  expect(value.defaultSubcommand).toBe("ls");
  expect(value.usage).toStartWith("bedrock errors [ls] <pebble>");
  expect(value.args).toEqual(errors.subcommands![0]!.args!);
  expect(value.flags.some(flag => flag.name === "--cursor")).toBe(true);
  const text = renderCommandHelp(["errors"], errors);
  expect(text).toStartWith("usage: bedrock errors [ls] <pebble>");
  expect(text).toContain("Arguments\n   <pebble>  Pebble whose issues to list");
  expect(text).toContain("bedrock errors show <pebble> <issue>");
});
