import { afterAll, describe, expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { complete, completeCommand, completionCommand, completionHelp, completionScript } from "./completion";
import type { CommandSpec } from "./spec";

const commands: readonly CommandSpec[] = [
  { name: "logs", aliases: ["log"], summary: "Read logs", remote: true, args: [{ name: "pebble" }], flags: [
    { name: "--follow", short: "-f", summary: "Follow" },
    { name: "--format", value: "<format>", choices: ["text", "json"], summary: "Format" },
    { name: "--search", value: "<text>", summary: "Search" },
  ] },
  { name: "db", summary: "Database", subcommands: [
    { name: "generate", aliases: ["gen"], summary: "Generate" },
    { name: "hidden", hidden: true, summary: "Hidden" },
  ] },
  { name: "new", summary: "New", args: [{ name: "template", choices: ["react", "minimal"] }] },
  { name: "errors", summary: "Errors", defaultSubcommand: "ls", subcommands: [
    { name: "ls", summary: "List", args: [{ name: "pebble", variadic: true }] },
    { name: "show", summary: "Show", args: [{ name: "pebble" }, { name: "id" }] },
  ] },
  { name: "__complete", hidden: true, aliases: ["internal"], summary: "Internal" },
];
const pebbles = async () => ["notes", "news", "--literal", "bad\nline"];

test("visible canonical names are offered and aliases still resolve", async () => {
  expect(await complete(["lo"], commands, {})).toEqual(["logs"]);
  expect(await complete([], commands, {})).toEqual(["logs", "db", "new", "errors"]);
  expect(await complete(["db", "g"], commands, {})).toEqual(["generate"]);
  expect(await complete(["db", "hidden", ""], commands, {})).toEqual([]);
  expect(await complete(["wat", ""], commands, {})).toEqual([]);
  expect(await complete(["db", "wat", ""], commands, {})).toEqual([]);
});

test("own, remote and global flags; used aliases and equals values", async () => {
  expect(await complete(["logs", "--"], commands, {})).toEqual(["--follow", "--format", "--search", "--url", "--token", "--json", "--help"]);
  expect(await complete(["db", "--u"], commands, {})).toEqual([]);
  expect(await complete(["logs", "-f", "--f"], commands, {})).toEqual(["--format"]);
  expect(await complete(["logs", "--format=json", "--f"], commands, {})).toEqual(["--follow"]);
  expect(await complete(["--json", "logs", "--j"], commands, {})).toEqual([]);
  expect(await complete(["logs", "--url", "http://localhost", "--u"], commands, {})).toEqual([]);
});

test("flag and positional choices, including values without choices", async () => {
  expect(await complete(["logs", "--format", "j"], commands, {})).toEqual(["json"]);
  expect(await complete(["logs", "--format=t"], commands, {})).toEqual(["--format=text"]);
  expect(await complete(["logs", "--search", "--"], commands, { pebbles })).toEqual([]);
  expect(await complete(["logs", "--url", ""], commands, { pebbles })).toEqual([]);
  expect(await complete(["new", "m"], commands, {})).toEqual(["minimal"]);
  expect(await complete(["new", "react", ""], commands, {})).toEqual([]);
  expect(await complete(["logs", "--typo", ""], commands, {})).toEqual([]);
});

test("pebbles, default subcommands, variadic args and end of options", async () => {
  expect(await complete(["log", "n"], commands, { pebbles })).toEqual(["notes", "news"]);
  expect(await complete(["errors", "n"], commands, { pebbles })).toEqual(["notes", "news"]);
  expect(await complete(["errors", "notes", "n"], commands, { pebbles })).toEqual(["notes", "news"]);
  expect(await complete(["errors", "show", "notes", "n"], commands, { pebbles })).toEqual([]);
  expect(await complete(["logs", "--", "--"], commands, { pebbles })).toEqual(["--literal"]);
  expect(await complete(["db", "--", "g"], commands, {})).toEqual([]);
  expect(await complete(["logs", ""], commands, {})).toEqual([]);
});

test("pebble lookup errors and a hung lister never block completion", async () => {
  expect(await complete(["logs", ""], commands, { pebbles: async () => { throw Error("offline"); } })).toEqual([]);
  const start = performance.now();
  expect(await complete(["logs", ""], commands, { pebbles: () => new Promise(() => {}) })).toEqual([]);
  expect(performance.now() - start).toBeLessThan(1000);
});

const temp = await mkdtemp(join(tmpdir(), "bedrock-completion-"));
afterAll(() => rm(temp, { recursive: true, force: true }));

for (const shell of ["bash", "zsh", "fish", "powershell"] as const) {
  test(`${shell} script and installation help`, () => {
    expect(completionScript(shell)).toContain("__complete");
    expect(completionScript(shell)).toContain("# Install:");
    expect(completionHelp).toContain(shell === "powershell" ? "PowerShell" : shell);
  });
}

async function shellRun(shell: string, code: string) {
  const child = Bun.spawn([shell, "-c", code], { env: { ...process.env, BEDROCK_HOME: join(temp, "home") }, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  expect(stderr).toBe("");
  expect(exit).toBe(0);
  return stdout.trim();
}

describe("installed shells", () => {
  test.skipIf(!Bun.which("bash"))("bash preserves current empty word, spaces and cursor position without bash-completion", async () => {
    const path = join(temp, "completion.bash");
    await Bun.write(path, completionScript("bash"));
    const output = await shellRun("bash", `source '${path}'
bedrock() { printf '<%s>\\n' "$@"; }
COMP_WORDS=(bedrock logs 'a b' '' ignored)
COMP_CWORD=3
_bedrock_complete
for candidate in "\${COMPREPLY[@]}"; do eval "printf '%s\\n' $candidate"; done`);
    expect(output).toBe("<__complete>\n<logs>\n<a b>\n<>");
  });
  test.skipIf(!Bun.which("fish"))("fish completes with real commandline tokenization", async () => {
    const path = join(temp, "completion.fish");
    await Bun.write(path, completionScript("fish"));
    const output = await shellRun("fish", `source '${path}'
function bedrock
  printf '<%s>\\n' $argv
end
complete -C 'bedrock logs "a b" '`);
    expect(output.split("\n").sort()).toEqual(["<>", "<__complete>", "<a b>", "<logs>"].sort());
  });
  test.skipIf(!Bun.which("zsh"))("zsh script syntax", async () => {
    const path = join(temp, "completion.zsh");
    await Bun.write(path, completionScript("zsh"));
    const child = Bun.spawn(["zsh", "-n", path], { stdout: "pipe", stderr: "pipe" });
    expect(await child.exited).toBe(0);
  });
  test.skipIf(!Bun.which("pwsh"))("PowerShell script syntax", async () => {
    const path = join(temp, "completion.ps1");
    await Bun.write(path, completionScript("powershell"));
    const child = Bun.spawn(["pwsh", "-NoProfile", "-Command", `$errors = $null; [void][System.Management.Automation.Language.Parser]::ParseFile('${path}', [ref]$null, [ref]$errors); if ($errors.Count) { exit 1 }`], { stdout: "pipe", stderr: "pipe" });
    expect(await child.exited).toBe(0);
  });
});

function captureOutput() {
  return spyOn(console, "log").mockImplementation(() => {});
}

test("entry functions print scripts, JSON or newline-separated candidates", async () => {
  const output = captureOutput();
  try {
    completionCommand(["bash"], false);
    expect(output.mock.calls[0]?.[0]).toBe(completionScript("bash"));
    completionCommand(["fish"], true);
    expect(JSON.parse(output.mock.calls[1]?.[0])).toEqual({ ok: true, command: "completion", shell: "fish", script: completionScript("fish") });
    await completeCommand(["lo"], false, commands);
    expect(output.mock.calls[2]?.[0]).toBe("logs");
    await completeCommand(["wat", ""], true, commands);
    expect(output).toHaveBeenCalledTimes(3);
    expect(() => completionCommand(["nope"], false)).toThrow("Choose a completion shell");
    expect(() => completionCommand(["bash", "extra"], false)).toThrow("Choose a completion shell");
  } finally { output.mockRestore(); }
});

test("hidden entry uses only the local daemon and local token, with a 500 ms budget", async () => {
  const home = join(temp, "local");
  const saved = { home: process.env.BEDROCK_HOME, url: process.env.BEDROCK_URL, token: process.env.BEDROCK_TOKEN };
  let mode = "ok";
  let requests = 0;
  const server = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    fetch(request) {
      requests++;
      expect(request.headers.get("authorization")).toBe("Bearer local-secret");
      expect(request.headers.get("host")).toBe(`bedrock.localhost:${server.port}`);
      expect(new URL(request.url).pathname).toBe("/api/pebbles");
      if (mode === "hang") return new Promise<Response>(() => {});
      if (mode === "offline") return new Response("offline", { status: 503 });
      return Response.json({ ok: true, value: [{ name: "notes" }, { name: "news" }, { invalid: true }] });
    },
  });
  const output = captureOutput();
  try {
    process.env.BEDROCK_HOME = home;
    process.env.BEDROCK_URL = "https://remote.invalid";
    process.env.BEDROCK_TOKEN = "remote-secret";
    await Bun.write(join(home, "daemon.json"), JSON.stringify({ port: server.port }));
    await Bun.write(join(home, "admin-token"), "local-secret\n");
    await completeCommand(["logs", "n"], false, commands);
    expect(output.mock.calls[0]?.[0]).toBe("notes\nnews");
    mode = "offline";
    await completeCommand(["logs", ""], false, commands);
    expect(output).toHaveBeenCalledTimes(1);
    mode = "hang";
    const start = performance.now();
    await completeCommand(["logs", ""], false, commands);
    expect(performance.now() - start).toBeLessThan(1000);
    expect(output).toHaveBeenCalledTimes(1);
    expect(requests).toBe(3);
    await rm(join(home, "admin-token"));
    await completeCommand(["logs", ""], false, commands);
    expect(requests).toBe(3);
  } finally {
    server.stop(true);
    output.mockRestore();
    for (const [name, value] of [["BEDROCK_HOME", saved.home], ["BEDROCK_URL", saved.url], ["BEDROCK_TOKEN", saved.token]]) {
      if (value === undefined) delete process.env[name!];
      else process.env[name!] = value;
    }
  }
});

test("completion skips descendant/default flag values before subcommands", async () => {
  const { commands: registry } = await import("./commands");
  expect(await complete(["alerts", "--url", "http://x", ""], registry)).toContain("ls");
  expect(await complete(["errors", "--cursor", "100", "n"], registry, { pebbles })).toEqual(["notes", "news"]);
  expect(await complete(["tunnel", "--api-token=X", "s"], registry)).toEqual(["setup", "status"]);
  expect(await complete(["tunnel", "--api-token", "-secret", "s"], registry)).toEqual(["setup", "status"]);
  expect(await complete(["errors", "--c"], registry)).toEqual(["--cursor"]);
});

test.skipIf(!Bun.which("bash"))("bash completion insertion quotes code, whitespace and metacharacters", async () => {
  const path = join(temp, "quoted.bash");
  await Bun.write(path, completionScript("bash"));
  const output = await shellRun("bash", `source '${path}'
bedrock() { printf '%s\\n' '$(printf EXECUTED)' 'space name' "a'b" '; printf EXECUTED' '\`printf EXECUTED\`' '$HOME' '[glob]*'; }
COMP_WORDS=(bedrock logs '')
COMP_CWORD=2
_bedrock_complete
for candidate in "\${COMPREPLY[@]}"; do eval "printf '%s\\n' $candidate"; done`);
  expect(output.split("\n")).toEqual(["$(printf EXECUTED)", "space name", "a'b", "; printf EXECUTED", "`printf EXECUTED`", "$HOME", "[glob]*"]);
});

test.skipIf(!Bun.which("fish"))("fish completion insertion keeps substitutions and punctuation literal", async () => {
  const path = join(temp, "quoted.fish");
  await Bun.write(path, completionScript("fish"));
  const output = await shellRun("fish", `source '${path}'
function bedrock
  printf '%s\\n' '$(printf EXECUTED)' 'space name' '; printf EXECUTED'
end
complete -C 'bedrock logs '`);
  expect(output.split("\n").sort()).toEqual(["$(printf EXECUTED)", "space name", "; printf EXECUTED"].sort());
});

test("zsh uses compadd escaping and PowerShell always quotes completion insertion", () => {
  expect(completionScript("zsh")).toContain('compadd -- "${candidates[@]}"');
  expect(completionScript("zsh")).not.toContain("compadd -Q");
  expect(completionScript("powershell")).toContain('$insert = "\'" + $text.Replace("\'", "\'\'") + "\'"');
});
