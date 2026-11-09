import { expect, test } from "bun:test";
import { join } from "node:path";
import { tempDirectory } from "./helpers";
import { parse } from "../src/cli/args";
import { alertsCommand } from "../src/cli/alerts";
import { backupCommand } from "../src/cli/backup";
import { creatorCommand } from "../src/cli/creator";
import { errorsCommand } from "../src/cli/errors";
import { jobsCommand } from "../src/cli/jobs";
import type { Handler } from "../src/cli/spec";

test("registry handlers preserve result commands and daemon requests", async () => {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const value = { fixture: true };
  const server = Bun.serve({ port: 0, async fetch(request) {
    const url = new URL(request.url);
    calls.push({ method: request.method, path: url.pathname + url.search, body: await request.json().catch(() => null) });
    return Response.json({ ok: true, value });
  } });
  const remote = ["--url", server.url.href, "--token", "fixture"];
  const cases: [Handler, string, string[], string, string, string, unknown?][] = [
    [alertsCommand, "alerts", [], "alerts ls", "GET", "/api/alerts"],
    [alertsCommand, "alerts", ["silence", "fingerprint", "--for=2h"], "alerts silence", "POST", "/api/alerts/silence", { fingerprint: "fingerprint", for: "2h" }],
    [errorsCommand, "errors", ["notes", "--cursor=next"], "errors list", "GET", "/api/pebbles/notes/errors?cursor=next"],
    [errorsCommand, "errors", ["list", "notes"], "errors list", "GET", "/api/pebbles/notes/errors"],
    [errorsCommand, "errors", ["merge", "notes", "1", "2", "--yes"], "errors merge", "POST", "/api/pebbles/notes/errors/1/merge?target=2&confirm=true"],
    [jobsCommand, "jobs", ["run", "notes", "clean up"], "jobs run", "POST", "/api/jobs/notes?job=clean%20up"],
    [jobsCommand, "jobs", ["history", "notes"], "jobs history", "GET", "/api/jobs/notes/history"],
    [backupCommand, "backup", ["restore", "notes", "--yes", "--at=timestamp"], "backup restore", "POST", "/api/backup/restore?name=notes&at=timestamp&confirm=true"],
    [creatorCommand, "pebble-token", ["create", "notes", "--name=agent", "--permissions=query:list,mutation:add"], "pebble-token create", "POST", "/api/pebbles/notes/service-tokens", { name: "agent", permissions: ["query:list", "mutation:add"] }],
    [creatorCommand, "session", ["create", "notes", "--ttl=5m", "--as=creator@example.test"], "session create", "POST", "/api/pebbles/notes/sessions?as=creator%40example.test", { ttl: "5m" }],
    [creatorCommand, "pebble-token", ["revoke", "notes", "token/id", "--yes"], "pebble-token revoke", "DELETE", "/api/pebbles/notes/service-tokens/token%2Fid"],
  ];
  try {
    for (const [handler, command, args, resultCommand, method, path, body = null] of cases) {
      expect(await handler(parse([command], [...args, ...remote]), true)).toEqual({ command: resultCommand, ok: true, value });
      expect(calls.at(-1)).toEqual({ method, path, body });
    }
  } finally { await server.stop(true); }
});

test("registry CLI errors name missing arguments, bad options and semantic conflicts", async () => {
  const temp = tempDirectory();
  const cases: [string[], string, string, string?][] = [
    [["alerts", "silence", "fp"], "INVALID_ARGS", "--for"],
    [["errors", "merge", "notes", "1"], "INVALID_ARGS", "<target>"],
    [["secrets", "set", "notes"], "INVALID_ARGS", "<NAME>"],
    [["secrets", "unset", "notes", "BEDROCK_URL"], "INVALID_ARGS", "BEDROCK_URL"],
    [["jobs", "rn", "notes", "cleanup"], "INVALID_ARGS", "'rn'", "bedrock jobs run notes cleanup"],
    [["backup", "setup", "--dir", "/unused", "--r2-account", "account"], "INVALID_ARGS", "--dir cannot be combined with --r2-account"],
    [["backup", "setup", "--r2-account", "account"], "INVALID_ARGS", "--r2-bucket"],
    [["pebble-token", "create", "notes", "--name", "  "], "INVALID_ARGS", "--name"],
    [["pebble-token", "create", "notes", "--name", "agent"], "INVALID_ARGS", "--permissions"],
    [["session", "create", "notes", "--tll", "5m"], "INVALID_ARGS", "--tll", "bedrock session create notes --ttl 5m"],
    [["session", "create", "notes", "--ttl", "61m"], "INVALID_ARGS", "61m"],
    [["errors", "merge", "notes", "1", "2"], "CONFIRM_REQUIRED", "Merging error issues requires confirmation."],
    [["backup", "restore", "notes"], "CONFIRM_REQUIRED", "Restore replaces pebble data and restarts the pebble."],
    [["pebble-token", "revoke", "notes", "id"], "CONFIRM_REQUIRED", "Revoking a pebble token removes its access."],
  ];
  try {
    for (const [args, code, message, suggestion] of cases) {
      const child = Bun.spawn([process.execPath, join(import.meta.dir, "../src/cli/index.ts"), ...args, "--json"], {
        env: { ...process.env, BEDROCK_HOME: temp.dir, BEDROCK_URL: undefined, BEDROCK_TOKEN: undefined },
        stdout: "pipe", stderr: "pipe",
      });
      const output = await new Response(child.stdout).text();
      expect(await child.exited).toBe(2);
      const error = JSON.parse(output).error;
      expect(error.code).toBe(code);
      expect(error.message).toContain(message);
      if (code === "INVALID_ARGS") expect(error.hint).toContain("usage: bedrock");
      if (suggestion) expect(error.data.suggestions).toContain(`${suggestion} --json`);
    }
  } finally { temp.cleanup(); }
});
