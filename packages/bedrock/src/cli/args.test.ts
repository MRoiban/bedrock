import { expect, test } from "bun:test";
import { BedrockError } from "../error";
import { parse, replaySuggestions, usageError } from "./args";
import type { CommandSpec } from "./spec";

const tree: readonly CommandSpec[] = [
  { name: "deploy", summary: "Deploy", remote: true, args: [{ name: "dir" }], flags: [{ name: "--force", short: "-f", summary: "Force deployment" }] },
  { name: "logs", summary: "Read logs", remote: true, args: [{ name: "pebble", required: true }], flags: [{ name: "--since", value: "<age>", summary: "How far back" }] },
  { name: "ls", aliases: ["list-all"], summary: "List" },
  { name: "new", summary: "Create", args: [{ name: "name", required: true }], flags: [
    { name: "--template", value: "<template>", choices: ["react", "minimal"], summary: "Starter" },
    { name: "--key", value: "<key>", secret: true, choices: ["private"], summary: "Key" },
  ] },
  { name: "tunnel", summary: "Tunnel", subcommands: ["setup", "status", "teardown"].map(name => ({ name, summary: name })) },
  { name: "alerts", summary: "Alerts", defaultSubcommand: "ls", subcommands: [{ name: "ls", summary: "List", remote: true }, { name: "silence", summary: "Silence", args: [{ name: "fingerprint", required: true }] }] },
  { name: "errors", summary: "Errors", defaultSubcommand: "ls", subcommands: [{ name: "ls", summary: "List", args: [{ name: "pebble", required: true }] }, { name: "show", aliases: ["view"], summary: "Show", args: [{ name: "pebble", required: true }, { name: "issue", required: true }] }] },
  { name: "completion", summary: "Complete", args: [{ name: "shell", required: true, choices: ["bash", "zsh", "fish"] }] },
  { name: "collect", summary: "Collect", args: [{ name: "first", required: true }, { name: "rest", variadic: true }] },
];

function failure(path: string[], argv: string[]) {
  try { parse(path, argv, tree); } catch (error) {
    expect(error).toBeInstanceOf(BedrockError);
    return error as BedrockError;
  }
  throw new Error("Expected parser failure");
}

test("long, equals and short flags use canonical names; remote and JSON flags are accepted", () => {
  const result = parse(["deploy"], ["--url=https://example.test", "-f", "notes", "--token", "secret", "--json"], tree);
  expect(result.path).toEqual(["deploy"]);
  expect(result.positionals).toEqual(["notes"]);
  expect(result.flags).toEqual({ "--url": "https://example.test", "--force": true, "--token": "secret", "--json": true });
  expect(parse(["logs"], ["--since", "1h", "notes"], tree).flags).toEqual({ "--since": "1h" });
  expect(parse(["list-all"], [], tree).path).toEqual(["ls"]);
});

test("-- ends options and variadic arguments keep all remaining positionals", () => {
  expect(parse(["logs"], ["--", "--help"], tree).positionals).toEqual(["--help"]);
  expect(parse(["collect"], ["one", "two", "--", "--json", "-f"], tree).positionals).toEqual(["one", "two", "--json", "-f"]);
});

const cases: readonly [string[], string[], string, string[]?][] = [
  [["deploy"], ["notes", "--frce"], "Unknown option --frce for bedrock deploy.", ["bedrock deploy notes --force"]],
  [["deploy"], ["--f", "notes"], "Unknown option --f for bedrock deploy.", ["bedrock deploy --force notes"]],
  [["deploy"], ["--frobnicate"], "Unknown option --frobnicate for bedrock deploy."],
  [["deploy"], ["-f", "--force"], "Repeated option --force for bedrock deploy."],
  [["logs"], ["notes", "--since"], "--since needs a value, e.g. --since <age>."],
  [["logs"], ["notes", "--since="], "--since needs a value, e.g. --since <age>."],
  [["logs"], ["--since", "--json", "notes"], "--since needs a value, e.g. --since <age>."],
  [["new"], ["notes", "--template", "raect"], "Invalid value 'raect' for --template; choose react, minimal.", ["bedrock new notes --template react"]],
  [["new"], ["notes", "--template=raect"], "Invalid value 'raect' for --template; choose react, minimal.", ["bedrock new notes --template=react"]],
  [["deploy"], ["--force=false"], "--force does not take a value."],
  [["logs"], [], "bedrock logs needs <pebble>."],
  [["ls"], ["x"], "Unexpected argument 'x' for bedrock ls."],
  [["tunnel"], ["setpu"], "'setpu' is not a bedrock tunnel command.", ["bedrock tunnel setup"]],
  [["tunnel"], [], "bedrock tunnel needs a subcommand: setup, status or teardown."],
  [["completion"], ["bsah"], "Invalid value 'bsah' for <shell>; choose bash, zsh, fish.", ["bedrock completion bash"]],
];
for (const [path, argv, message, suggestions] of cases) {
  test(message, () => {
    const error = failure(path, argv);
    expect(error.code).toBe("INVALID_ARGS");
    expect(error.message).toBe(message);
    expect(error.data).toEqual(suggestions ? { suggestions } : undefined);
    expect(error.hint).toStartWith(`usage: bedrock ${path.join(" ")}`);
    expect(error.hint).toEndWith(`Run 'bedrock help ${path.join(" ")}' for details.`);
    expect(error.hint).not.toContain("Build a pebble");
  });
}

test("defaults preserve real positional names and report subcommand typos only on arity failure", () => {
  expect(parse(["alerts"], [], tree).path).toEqual(["alerts", "ls"]);
  expect(parse(["alerts"], ["--token", "secret"], tree).flags).toEqual({ "--token": "secret" });
  expect(parse(["errors"], ["shwo"], tree)).toMatchObject({ path: ["errors", "ls"], positionals: ["shwo"] });
  expect(parse(["errors"], ["view", "notes", "123"], tree).path).toEqual(["errors", "show"]);
  expect(parse(["errors", "show"], ["notes", "123"], tree).positionals).toEqual(["notes", "123"]);
  expect(failure(["alerts"], ["slience"]).toJSON()).toMatchObject({ message: "'slience' is not a bedrock alerts command.", data: { suggestions: ["bedrock alerts silence"] } });
  expect(failure(["errors", "show"], ["notes"]).hint).toContain("Run 'bedrock help errors show' for details.");
});

test("suggestions replay every other word and redact separated and inline secrets", () => {
  for (const secret of [["--token", "super-secret"], ["--token=super-secret"]]) {
    const error = failure(["deploy"], [...secret, "notes", "--frce", "--json"]);
    expect(error.data).toEqual({ suggestions: ["bedrock deploy --token <token> notes --force --json"] });
    expect(JSON.stringify(error.toJSON())).not.toContain("super-secret");
  }
  for (const argv of [["notes", "--key", "prviate"], ["notes", "--key=prviate"]]) {
    const error = failure(["new"], argv);
    expect(error.message).toBe("Invalid value '<key>' for --key; choose private.");
    expect(error.data).toEqual({ suggestions: ["bedrock new notes --key <key>"] });
    expect(JSON.stringify(error.toJSON())).not.toContain("prviate");
  }
});

test("replay targets one occurrence, quotes shell words and preserves the -- boundary", () => {
  expect(replaySuggestions(["errors", "noets", "noets", "--token=secret", "--json"], "noets", ["notes"], tree))
    .toEqual(["bedrock errors notes noets --token <token> --json"]);
  expect(replaySuggestions(["logs", "a'b c", "--", "--token=literal"], 1, ["space name"], tree))
    .toEqual(["bedrock logs 'space name' -- --token=literal"]);
  expect(replaySuggestions(["logs", "notes"], "absent", ["other"], tree)).toEqual([]);
});

test("cross-flag rules share the usage hint and help flags cannot reach an implementation", () => {
  expect(usageError(["logs"], "Flags conflict.", ["bedrock logs notes"], tree).toJSON()).toMatchObject({ code: "INVALID_ARGS", message: "Flags conflict.", data: { suggestions: ["bedrock logs notes"] } });
  expect(failure(["logs"], ["notes", "--help"]).message).toBe("Use bedrock help logs to show help.");
});

test("single-dash values are consumed unless they name a declared flag", () => {
  expect(parse(["token"], ["--name", "-agent", "create"]).flags["--name"]).toBe("-agent");
  expect(parse(["test"], ["--list", "--grep", "-x"]).flags["--grep"]).toBe("-x");
  expect(parse(["logs"], ["notes", "--token", "-abc"]).flags["--token"]).toBe("-abc");
  expect(parse(["backup"], ["--r2-secret-access-key", "-r2-secret", "setup"]).flags["--r2-secret-access-key"]).toBe("-r2-secret");
  for (const word of ["--follow", "-f", "--url", "--json", "--unknown"]) {
    expect(() => parse(["logs"], ["notes", "--since", word])).toThrow("--since needs a value");
  }
});

test("incomplete subcommand forms fall back to the default positional form", () => {
  for (const name of ["show", "ls", "list", "resolve", "ignore", "merge"]) {
    expect(parse(["errors"], [name])).toMatchObject({ path: ["errors", "ls"], positionals: [name] });
  }
  expect(parse(["errors"], ["show", "notes", "42"])).toMatchObject({ path: ["errors", "show"], positionals: ["notes", "42"] });
  expect(() => parse(["errors"], ["show", "notes"])).toThrow("needs <issue>");
});

test("descendant flags before unknown subcommands still allow command repair", () => {
  const error = (() => {
    try { parse(["tunnel"], ["--api-token", "X", "setpu"]); } catch (error) { return error as BedrockError; }
    throw Error("Expected failure");
  })();
  expect(error.message).toBe("'setpu' is not a bedrock tunnel command.");
  expect(error.data).toEqual({ suggestions: ["bedrock tunnel --api-token <token> setup"] });
  expect(parse(["tunnel"], ["--api-token=X", "status"]).path).toEqual(["tunnel", "status"]);
});

test("unknown flag repairs use synonyms, omit help and warn before confirmation", () => {
  for (const flag of ["-n", "--lines", "--tail"]) {
    try { parse(["logs"], [flag, "50", "notes"]); throw Error("Expected failure"); } catch (error) {
      expect((error as BedrockError).data).toEqual({ suggestions: ["bedrock logs --limit 50 notes"] });
    }
  }
  for (const flag of ["-f", "--force", "-y"]) {
    try { parse(["rm"], [flag, "notes"]); throw Error("Expected failure"); } catch (error) {
      expect((error as BedrockError).message).toContain("Use --yes to confirm deletion");
      expect((error as BedrockError).data).toEqual({ suggestions: ["bedrock rm notes --yes"] });
    }
  }
  for (const flag of ["-q", "--hel", "--halp"]) {
    const error = failure(["deploy"], [flag]);
    expect(JSON.stringify(error.data ?? {})).not.toMatch(/--help|-h(?: |")/);
  }
});

test("confirmation repairs stay before -- and retain secret redaction", () => {
  try { parse(["rm"], ["-f", "--token", "-secret", "--", "notes"]); throw Error("Expected failure"); } catch (error) {
    expect((error as BedrockError).data).toEqual({ suggestions: ["bedrock rm --token <token> --yes -- notes"] });
  }
});

test("choice errors do not quote inline values inside option-looking words", () => {
  const error = failure(["new"], ["notes", "--template=--api-token=SENTINEL"]);
  expect(error.message).toBe("Invalid value '--api-token' for --template; choose react, minimal.");
  expect(JSON.stringify(error.toJSON())).not.toContain("SENTINEL");
});

test("values after misspelled secret flags are redacted from repairs of another word", () => {
  const error = (() => {
    try { parse(["tunnel"], ["setpu", "--api-tokne", "SENTINEL"]); } catch (error) { return error as BedrockError; }
    throw Error("Expected failure");
  })();
  expect(error.data).toEqual({ suggestions: ["bedrock tunnel setup --api-tokne <token>"] });
  expect(JSON.stringify(error.toJSON())).not.toContain("SENTINEL");
});

test("pagination flags keep the default form for pebbles named like a subcommand", () => {
  for (const name of ["resolve", "ignore"]) {
    expect(parse(["errors"], ["--cursor", "100", name])).toMatchObject({ path: ["errors", "ls"], positionals: [name], flags: { "--cursor": "100" } });
  }
});

test("secret redaction only takes real values and only for flags nearest a secret one", () => {
  const replay = (argv: string[]) => {
    try { parse([argv[0]!], argv.slice(1)); } catch (error) { return (error as BedrockError).data; }
    throw Error("Expected failure");
  };
  const leaked = replay(["tunnel", "setpu", "--api-tokne", "--token", "SENTINEL"]);
  expect(leaked).toEqual({ suggestions: ["bedrock tunnel setup --api-tokne <token> --token <token>"] });
  expect(replay(["metrics", "notes", "--tep", "1m"])).toEqual({ suggestions: ["bedrock metrics notes --step 1m"] });
  expect(replay(["logs", "--jon", "notes"])).toEqual({ suggestions: ["bedrock logs --json notes"] });
});

test("any single-dash word after a secret flag is redacted, even a flag of another command", () => {
  try { parse(["metrics"], ["notes", "--tep", "1m", "--token", "-f=SENTINEL"]); } catch (error) {
    expect(JSON.stringify((error as BedrockError).toJSON())).not.toContain("SENTINEL");
    return;
  }
  throw Error("Expected failure");
});
