import { expect, test } from "bun:test";
import { parse } from "./args";
import { opsCommand } from "./ops";
import { daemonCommand } from "./daemon";

for (const command of ["login", "logout", "doctor", "service", "tunnel"]) test(`${command} invalid arguments have command-specific hints`, async () => {
  const hint = expect.stringContaining(`bedrock ${command}`);
  for (const args of [["--unknown"], ["unexpected", "extra"]]) await expect((async () => opsCommand(parse([command], args), false))()).rejects.toMatchObject({ code: "INVALID_ARGS", hint });
  if (["login", "service", "tunnel"].includes(command)) await expect((async () => opsCommand(parse([command], []), false))()).rejects.toMatchObject({ code: "INVALID_ARGS", hint });
});

for (const command of ["daemon", "deploy", "ls", "logs", "start", "stop", "restart", "rollback", "rm", "token", "whoami", "status", "metrics"]) test(`${command} invalid arguments have command-specific hints`, async () => {
  await expect((async () => daemonCommand(parse([command], ["--unknown"]), false))()).rejects.toMatchObject({ code: "INVALID_ARGS", hint: expect.stringContaining(`bedrock ${command}`) });
});

for (const [command, args, message] of [
  ["token", ["create", "--pebbles", "notes"], "--pebbles and --actions must be provided together."],
  ["token", ["create", "--actions", "logs"], "--pebbles and --actions must be provided together."],
  ["token", ["revoke", "bad"], "Invalid token ID 'bad'; expected 64 lowercase hexadecimal characters."],
  ["logs", ["notes", "-f", "--search", "timeout"], "--follow cannot be combined with --search."],
  ["logs", ["notes", "--follow", "--since", "1h"], "--follow cannot be combined with --since."],
  ["logs", ["notes", "-f", "--cursor", "page"], "--follow cannot be combined with --cursor."],
  ["logs", ["notes", "-f", "--limit", "10"], "--follow cannot be combined with --limit."],
] as const) test(`${command} ${args.join(" ")} rejects incompatible arguments before connecting`, async () => {
  await expect(daemonCommand(parse([command], [...args]), true)).rejects.toMatchObject({
    code: "INVALID_ARGS", message, hint: expect.stringContaining(`bedrock ${command}`),
  });
});

test("login requires a domain or URL and excludes supplying both", async () => {
  await expect(opsCommand(parse(["login"], []), true)).rejects.toMatchObject({ code: "INVALID_ARGS", message: "bedrock login needs <domain> or --url <url>." });
  await expect(opsCommand(parse(["login"], ["example.com", "--url=https://bedrock.example.com"]), true)).rejects.toMatchObject({ code: "INVALID_ARGS", message: "Domain 'example.com' cannot be combined with --url." });
});

test("destructive commands retain confirmation errors before reading configuration", async () => {
  await expect(daemonCommand(parse(["rm"], ["notes"]), true)).rejects.toMatchObject({ code: "CONFIRM_REQUIRED", message: "Deleting a pebble removes all code, data, and logs." });
  await expect(opsCommand(parse(["tunnel"], ["teardown"]), true)).rejects.toMatchObject({ code: "CONFIRM_REQUIRED", message: "Tunnel teardown disconnects your public server." });
});

test("tunnel rejects flags outside their subcommands", () => {
  for (const args of [["setup", "--yes"], ["status", "--yes"], ["teardown", "--zone-id", "zone"]]) {
    expect(() => parse(["tunnel"], args)).toThrow("Unknown option");
  }
});

test("parsed token subcommands preserve daemon requests and result envelopes", async () => {
  const requests: { method: string; path: string; body: unknown }[] = [];
  const server = Bun.serve({ port: 0, async fetch(request) {
    requests.push({ method: request.method, path: new URL(request.url).pathname, body: request.method === "POST" ? await request.json() : null });
    return Response.json({ ok: true, value: { fixture: true } });
  } });
  const id = "a".repeat(64);
  const remote = [`--url=${server.url.href}`, "--token=fixture"];
  try {
    for (const args of [["create", "--name=monitor", "--pebbles=notes,bot-*", "--actions=monitor"], ["ls"], ["revoke", id]]) {
      const parsed = parse(["token"], [...args, ...remote]);
      expect(await daemonCommand(parsed, true)).toEqual({ command: parsed.path.join(" "), ok: true, value: { fixture: true } });
    }
    expect(requests).toEqual([
      { method: "POST", path: "/api/tokens", body: { name: "monitor", scope: { pebbles: ["notes", "bot-*"], actions: ["monitor"] } } },
      { method: "GET", path: "/api/tokens", body: null },
      { method: "DELETE", path: `/api/tokens/${id}`, body: null },
    ]);
  } finally { await server.stop(true); }
});

for (const value of ["abc", "70000", "-1", "1.5"]) test(`daemon rejects port ${value} before startup`, async () => {
  await expect(daemonCommand(parse(["daemon"], [`--port=${value}`]), false)).rejects.toMatchObject({ code: "INVALID_ARGS", message: `Invalid value '${value}' for --port; use an integer from 0 to 65535.` });
});

for (const command of ["metrics", "logs"]) {
  for (const [flag, values] of [["--limit", ["0", "1001", "abc", "1.5"]], ["--since", ["0s", "366d", "abc", "1.5h"]]] as const) {
    for (const value of values) test(`${command} rejects ${flag} ${value} before connection`, async () => {
      await expect(daemonCommand(parse([command], ["notes", `${flag}=${value}`]), false)).rejects.toMatchObject({ code: "INVALID_ARGS", message: expect.stringContaining(`Invalid value '${value}' for ${flag}`), hint: expect.stringContaining(`bedrock ${command}`) });
    });
  }
}

test("doctor text omits repair hints for passing checks only", async () => {
  const { formatDoctor } = await import("./ops");
  const checks = [
    { name: "bun", status: "pass" as const, message: "Bun 1.4.3", hint: "Install Bun >= 1.2." },
    { name: "config", status: "fail" as const, message: "Missing", hint: "Run setup." },
    { name: "oauth", status: "warn" as const, message: "Not set", hint: "Configure OAuth." },
  ];
  expect(formatDoctor(checks)).toBe("PASS bun: Bun 1.4.3\nFAIL config: Missing\n  Hint: Run setup.\nWARN oauth: Not set\n  Hint: Configure OAuth.");
  expect(checks[0]!.hint).toBe("Install Bun >= 1.2.");
});

test("follow strips escape sequences split over transport chunks and keeps JSON intact", async () => {
  const { spyOn } = await import("bun:test");
  const server = Bun.serve({ port: 0, fetch(request) {
    if (!new URL(request.url).searchParams.has("follow")) return Response.json({ value: {} });
    return new Response(new ReadableStream({ async start(controller) {
      for (const chunk of ["\x1b]0;evil", "\x07hello\tworld\x1b[", "31m\nnext\x00\n"]) {
        controller.enqueue(new TextEncoder().encode(chunk));
        await Bun.sleep(2);
      }
      controller.close();
    } }));
  } });
  const args = ["notes", "--follow", `--url=${server.url.href}`, "--token=fixture"];
  const output: string[] = [];
  const write = spyOn(process.stdout, "write").mockImplementation((chunk: any) => { output.push(String(chunk)); return true; });
  try {
    await daemonCommand(parse(["logs"], args), false);
    expect(output.join("")).toBe("hello\tworld\nnext\n");
    output.length = 0;
    await daemonCommand(parse(["logs"], args), true);
    expect(JSON.parse(output.join("")).logs).toBe("\x1b]0;evil\x07hello\tworld\x1b[31m\nnext\x00\n");
  } finally { write.mockRestore(); await server.stop(true); }
});
